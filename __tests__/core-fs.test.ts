import assert from 'node:assert/strict';
import type { PathLike } from 'node:fs';
import fsPromises, {
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { after, before, describe, it, mock } from 'node:test';

import { ErrorCode, isFsError, Problem } from '../src/core/errors.ts';
import { buildWrittenFileMeta, writtenFileLinks } from '../src/core/file-uri.ts';
import { GuardedFileSystem } from '../src/core/fs.ts';
import { normalizePath } from '../src/core/path-utils.ts';
import { readFileBufferWithLimit, readFileWithStats } from '../src/core/read.ts';
import { searchContent, searchFiles } from '../src/core/search.ts';
import { getMaxTextFileSize } from '../src/core/util.ts';
import type { FilesystemServerContext } from '../src/server.ts';
import {
  cleanupTestRoot,
  createTestClientPair,
  createTestRoot,
  createTestServer,
  fsErrorMatcher,
  trySymlink,
  withEnv,
  writeNLineFile,
  writeTestFile,
} from './helpers.ts';

describe('Core Filesystem (GuardedFileSystem + core search) Tests', () => {
  let tmpDir: string;
  let ctx: FilesystemServerContext;
  let fs: GuardedFileSystem;

  before(async () => {
    tmpDir = await createTestRoot();
    ctx = await createTestServer([tmpDir]);
    fs = new GuardedFileSystem(ctx.pathGuard);
  });

  after(async () => {
    if (ctx) {
      ctx.disposeRuntimeState();
      await ctx.mcp.close();
    }
    if (tmpDir) {
      await cleanupTestRoot(tmpDir);
    }
  });

  it('SDK-AUDIT-CANCEL-002: a pre-aborted raw read starts no validation or I/O', async (t) => {
    const filePath = await writeTestFile(tmpDir, 'raw-aborted.txt', 'unchanged');
    const reason = new DOMException('Raw read cancelled', 'AbortError');
    const validation = t.mock.method(ctx.pathGuard, 'validateExistingPath');
    const stats = t.mock.method(fsPromises, 'stat');
    const reads = t.mock.method(fsPromises, 'readFile');
    syncBuiltinESMExports();
    try {
      await assert.rejects(
        fs.readRaw(filePath, { signal: AbortSignal.abort(reason) }),
        (error) => error === reason,
      );
      assert.strictEqual(validation.mock.callCount(), 0);
      assert.strictEqual(stats.mock.callCount(), 0);
      assert.strictEqual(reads.mock.callCount(), 0);
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });

  for (const { id, name, code } of [
    { id: '003', name: 'AbortError', code: ErrorCode.CANCELLED },
    { id: '005', name: 'TimeoutError', code: ErrorCode.TIMEOUT },
  ]) {
    it(`SDK-AUDIT-CANCEL-${id}: native raw reads preserve the ${name} signal reason`, async (t) => {
      const filePath = await writeTestFile(tmpDir, 'raw-native-cancel.txt', 'unchanged');
      const controller = new AbortController();
      const reason = new DOMException('Cancel at native read', name);
      const originalRead = fsPromises.readFile;
      let nativeSignal: AbortSignal | undefined;
      t.mock.method(
        fsPromises,
        'readFile',
        async (...args: Parameters<typeof fsPromises.readFile>) => {
          const options = args[1];
          nativeSignal =
            typeof options === 'object' && options !== null ? options.signal : undefined;
          controller.abort(reason);
          return originalRead(...args);
        },
      );
      syncBuiltinESMExports();
      try {
        await assert.rejects(
          fs.readRaw(filePath, { signal: controller.signal }),
          (error: unknown) => {
            assert.strictEqual(Problem.fromUnknown(error, ErrorCode.NOT_FILE).code, code);
            assert.strictEqual(error, reason);
            return true;
          },
        );
        assert.strictEqual(nativeSignal, controller.signal);
      } finally {
        t.mock.restoreAll();
        syncBuiltinESMExports();
      }
    });
  }

  it('SDK-AUDIT-CANCEL-006: concurrent cancellation does not hide a native I/O failure', async (t) => {
    const filePath = await writeTestFile(tmpDir, 'raw-native-failure.txt', 'unchanged');
    const controller = new AbortController();
    const failure = Object.assign(new Error('Native read failed'), { code: 'EIO' });
    t.mock.method(fsPromises, 'readFile', () => {
      controller.abort(new DOMException('Deadline elapsed', 'TimeoutError'));
      return Promise.reject(failure);
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(
        fs.readRaw(filePath, { signal: controller.signal }),
        (error: unknown) => error === failure,
      );
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });

  it('every read path re-checks the opened descriptor against the roots', async (t) => {
    const filePath = await writeTestFile(tmpDir, 'fd-recheck.txt', 'in-root\n');
    // Make the descriptor read back as out-of-root on every OS, so the
    // Linux-only /proc/self/fd re-check is exercised here too.
    const originalReadlink = fsPromises.readlink.bind(fsPromises);
    t.mock.method(fsPromises, 'readlink', (path: PathLike) =>
      String(path).startsWith('/proc/self/fd/')
        ? Promise.resolve('/outside-roots/secret.txt')
        : originalReadlink(path),
    );
    syncBuiltinESMExports();
    try {
      const reads: Record<string, () => Promise<unknown>> = {
        readFile: () => fs.readFile(filePath, { kind: 'full' }),
        readEditableText: () => fs.readEditableText(filePath),
        readRaw: () => fs.readRaw(filePath),
        open: async () => {
          await (await fs.open(filePath)).close();
        },
        readLeadingSample: () => fs.readLeadingSample(filePath),
        countFileLines: () => fs.countFileLines(filePath),
      };
      for (const [name, read] of Object.entries(reads)) {
        await assert.rejects(read(), fsErrorMatcher(ErrorCode.ACCESS_DENIED, 'TOCTOU'), name);
      }
    } finally {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    }
  });

  describe('Read slicing & batch (TC-FUNC-002–006)', () => {
    it('TC-FUNC-002: readFile with head slicing returns first N lines', async () => {
      const filePath = await writeNLineFile(tmpDir, 'read_head.txt', 10);
      const result = await fs.readFile(filePath, { kind: 'head', lines: 5 });

      assert.strictEqual(result.readMode, 'head');
      assert.strictEqual(result.head, 5);
      assert.strictEqual(result.linesRead, 5);
      assert.strictEqual(result.hasMoreLines, true);
      assert.strictEqual(result.content, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5');
    });

    it('TC-FUNC-003: readFile with tail slicing returns last N lines', async () => {
      const filePath = await writeNLineFile(tmpDir, 'read_tail.txt', 10);
      const result = await fs.readFile(filePath, { kind: 'tail', lines: 3 });

      assert.strictEqual(result.readMode, 'tail');
      assert.strictEqual(result.tail, 3);
      assert.strictEqual(result.linesRead, 3);
      assert.strictEqual(result.content, 'Line 8\nLine 9\nLine 10');
    });

    it('TC-FUNC-004: readFile with line range returns specific lines', async () => {
      const filePath = await writeNLineFile(tmpDir, 'read_range.txt', 10);
      const result = await fs.readFile(filePath, {
        kind: 'range',
        start: 2,
        end: 4,
      });

      assert.strictEqual(result.readMode, 'range');
      assert.strictEqual(result.startLine, 2);
      assert.strictEqual(result.endLine, 4);
      assert.strictEqual(result.linesRead, 3);
      assert.strictEqual(result.content, 'Line 2\nLine 3\nLine 4');
    });

    it('a range read decodes lines across stream chunks the same from any start line', async () => {
      const CHUNK = 64 * 1024; // STREAM_CHUNK_SIZE in src/core/read.ts
      for (const eol of ['\n', '\r\n']) {
        const raw: Buffer[] = [];
        const expected: string[] = [];
        let written = 0;
        const line = (text: string, bytes = Buffer.from(text)) => {
          raw.push(bytes, Buffer.from(eol));
          expected.push(text);
          written += bytes.length + eol.length;
        };
        // ASCII padding puts the next chunk boundary after `head` bytes of `text`.
        const straddle = (head: number, text: string, bytes = Buffer.from(text)) => {
          const pad = '.'.repeat(CHUNK - (written % CHUNK) - head);
          line(pad + text, Buffer.concat([Buffer.from(pad), bytes]));
        };
        // Each start line must decode as if the lines before it were never read.
        straddle(1, 'é');
        straddle(2, '😀');
        straddle(4, '日本'); // the boundary falls inside 本
        straddle(3, 'ab'); // the chunk ends on the LF, or between CR and LF
        line('cd');
        // A truncated 日 ends a chunk; the next line's bytes would complete it.
        straddle(1, '\uFFFD', Buffer.from([0xe6]));
        line('\uFFFD\uFFFDok', Buffer.from([0x97, 0xa5, 0x6f, 0x6b]));
        straddle(2, '\uFFFD', Buffer.from([0xf0, 0x9f, 0x98])); // a truncated emoji
        raw.push(Buffer.from('end'));
        expected.push('end');

        const filePath = join(tmpDir, 'range-chunks.txt');
        await writeFile(filePath, Buffer.concat(raw));
        for (let start = 1; start <= expected.length; start++) {
          const label = `${JSON.stringify(eol)} from line ${start}`;
          const result = await fs.readFile(filePath, { kind: 'range', start });
          assert.strictEqual(result.content, expected.slice(start - 1).join('\n'), label);
          assert.strictEqual(result.linesRead, expected.length - start + 1, label);
          assert.strictEqual(result.hasMoreLines, false, label);
        }
      }
    });

    it('a range read does not decode the lines before its start', async (t) => {
      const filePath = await writeNLineFile(tmpDir, 'read_range_skip.txt', 20_000);
      const write = t.mock.method(StringDecoder.prototype, 'write');

      const result = await fs.readFile(filePath, { kind: 'range', start: 19_999, end: 20_000 });

      assert.strictEqual(result.content, 'Line 19999\nLine 20000');
      const decodedBytes = write.mock.calls.reduce(
        (sum, call) => sum + Buffer.byteLength(call.arguments[0]),
        0,
      );
      assert.strictEqual(decodedBytes, Buffer.byteLength('Line 19999Line 20000'));
    });

    it('TC-FUNC-006: readFile full returns entire content and line count', async () => {
      const filePath = await writeNLineFile(tmpDir, 'read_full.txt', 5);
      const result = await fs.readFile(filePath, { kind: 'full' });

      assert.strictEqual(result.readMode, 'full');
      assert.strictEqual(result.totalLines, 5);
      assert.strictEqual(result.hasMoreLines, false);
      assert.strictEqual(result.content, 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n');
    });
  });

  describe('Oversize read refusal', () => {
    const limit = 1024 * 1024;
    const cases = [
      {
        name: 'full read past the limit',
        spec: { kind: 'full' },
        message: new RegExp(`^File exceeds size limit \\(${limit + 1} > ${limit} bytes\\)$`),
        suggestion: 'Use head to preview.',
      },
      {
        name: 'range read hitting one over-long line',
        spec: { kind: 'range', start: 1 },
        message: new RegExp(`^File exceeds size limit \\(\\d+ > ${limit} bytes, single line\\)$`),
        suggestion: 'Use a narrower range or head.',
      },
      {
        name: 'tail read that cannot collect its lines',
        spec: { kind: 'tail', lines: 2 },
        message: new RegExp(
          `^File exceeds size limit \\(\\d+ > ${limit} bytes, could not collect 2 lines\\)$`,
        ),
        suggestion: 'Use a narrower tail or head.',
      },
    ] as const;

    for (const { name, spec, message, suggestion } of cases) {
      it(`${name} names the limit and forwards its own remedy`, async () => {
        await withEnv({ FS_MAX_FILE_SIZE: String(limit) }, async () => {
          const filePath = join(tmpDir, 'oversize-read.txt');
          await writeFile(filePath, Buffer.alloc(limit + 1, 0x61));

          await assert.rejects(fs.readFile(filePath, spec), (error: unknown) => {
            fsErrorMatcher(ErrorCode.TOO_LARGE, message)(error);
            assert(isFsError(error));
            assert.strictEqual(error.problem.suggestion, suggestion);
            return true;
          });
        });
      });
    }
  });

  describe('Editable text loading', () => {
    it('readEditableText returns validated path, content, and stats', async () => {
      const filePath = await writeTestFile(tmpDir, 'editable.txt', 'editable content');

      const result = await fs.readEditableText(filePath);

      assert.strictEqual(result.validPath, normalizePath(filePath));
      assert.strictEqual(result.content, 'editable content');
      assert.strictEqual(result.stats.size, Buffer.byteLength('editable content'));
    });

    it('readEditableText rejects files above the configured text limit', async () => {
      const limit = 1024 * 1024;
      await withEnv({ FS_MAX_FILE_SIZE: String(limit) }, async () => {
        const filePath = join(tmpDir, 'too-large.txt');
        await writeFile(filePath, Buffer.alloc(limit + 1, 0x61));

        await assert.rejects(
          fs.readEditableText(filePath),
          fsErrorMatcher(ErrorCode.TOO_LARGE, 'File too large for edit'),
        );
      });
    });

    it('readEditableText rejects binary files', async () => {
      const filePath = join(tmpDir, 'editable.png');
      await writeFile(filePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

      await assert.rejects(
        fs.readEditableText(filePath),
        fsErrorMatcher(ErrorCode.INVALID_INPUT, /^Binary file detected\.$/),
      );
    });

    // Issue #11: the 512-byte binary probe must not reject a multi-byte
    // character cut by the sample boundary, but must still reject a byte that
    // no continuation can make valid.
    it('binary probe accepts UTF-8 split at the sample boundary', async () => {
      for (const [name, text] of [
        ['split-cjk.md', '我'.repeat(171)],
        ['split-emoji.txt', `${'a'.repeat(510)}${'😀'.repeat(4)}`],
        ['split-latin.txt', `${'a'.repeat(511)}${'é'.repeat(4)}`],
      ] as const) {
        const filePath = join(tmpDir, name);
        await writeFile(filePath, text);
        assert.strictEqual((await fs.readFile(filePath, { kind: 'full' })).content, text, name);
        assert.strictEqual((await fs.readEditableText(filePath)).content, text, name);
      }

      const invalid = join(tmpDir, 'split-invalid.txt');
      await writeFile(invalid, Buffer.concat([Buffer.alloc(511, 0x61), Buffer.from([0xc0, 0x61])]));
      await assert.rejects(
        fs.readFile(invalid, { kind: 'full' }),
        (error) => isFsError(error) && error.message === 'Binary file detected.',
      );
    });

    it('partial reads never combine UTF-8 bytes across line boundaries', async () => {
      const filePath = join(tmpDir, 'split-lines.txt');
      const prefix = 'a'.repeat(512);
      await writeFile(
        filePath,
        Buffer.concat([Buffer.from(prefix), Buffer.from([0xe2, 0x0a, 0x82, 0xac, 0x0a])]),
      );

      const full = await fs.readFile(filePath, { kind: 'full' });
      assert.strictEqual(full.content, `${prefix}\uFFFD\n\uFFFD\uFFFD\n`);
      const head = await fs.readFile(filePath, { kind: 'head', lines: 2 });
      assert.strictEqual(head.content, `${prefix}\uFFFD\n\uFFFD\uFFFD`);
      const range = await fs.readFile(filePath, { kind: 'range', start: 2, end: 2 });
      assert.strictEqual(range.content, '\uFFFD\uFFFD');

      await writeFile(filePath, `${prefix}€\n😀\né`);
      assert.strictEqual(
        (await fs.readFile(filePath, { kind: 'head', lines: 3 })).content,
        `${prefix}€\n😀\né`,
      );
    });

    it('readEditableText rejects non-UTF-8 bytes past the binary probe', async () => {
      const filePath = join(tmpDir, 'latin1-late.txt');
      await writeFile(
        filePath,
        Buffer.concat([
          Buffer.alloc(600, 0x61),
          Buffer.from('\ncaf'),
          Buffer.from([0xe9]),
          Buffer.from('\n'),
        ]),
      );
      await assert.rejects(
        fs.readEditableText(filePath),
        fsErrorMatcher(ErrorCode.INVALID_INPUT, /^Binary or non-UTF-8 file detected\.$/),
      );
      // The read-only `read` tool path must stay lossy-but-tolerant: unchanged behavior.
      const fullRead = await fs.readFile(filePath, { kind: 'full' });
      assert.ok(fullRead.content.endsWith('caf\uFFFD\n'));

      const utf16 = join(tmpDir, 'utf16le.txt');
      await writeFile(
        utf16,
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hello\n', 'utf16le')]),
      );
      // UTF-16 is named at the shared probe, for edit as for read.
      await assert.rejects(
        fs.readEditableText(utf16),
        fsErrorMatcher(
          ErrorCode.INVALID_INPUT,
          /^UTF-16 text file detected; convert it to UTF-8 first\.$/,
        ),
      );
    });
  });

  describe('Create nested & overwrite (TC-FUNC-010–011)', () => {
    it('TC-FUNC-010: writeFile in deep nested path after creating parent directories', async () => {
      const nestedPath = join(tmpDir, 'deep', 'nested', 'subfolder', 'file.txt');
      await fs.mkdir(dirname(nestedPath), { recursive: true });
      await fs.writeFile(nestedPath, 'deep nested content');

      const { content } = await fs.readRaw(nestedPath);
      assert.strictEqual(content.toString('utf-8'), 'deep nested content');
    });

    it('TC-FUNC-011: writeFile overwriting existing file', async () => {
      const filePath = join(tmpDir, 'overwrite_target.txt');
      await fs.writeFile(filePath, 'initial content');

      const initialRead = await fs.readRaw(filePath);
      assert.strictEqual(initialRead.content.toString('utf-8'), 'initial content');

      await fs.writeFile(filePath, 'overwritten content');

      const overwrittenRead = await fs.readRaw(filePath);
      assert.strictEqual(overwrittenRead.content.toString('utf-8'), 'overwritten content');
    });
  });

  describe('Append (TC-FUNC-047–052)', () => {
    it('TC-FUNC-047: appendFile creates a missing file with the content', async () => {
      const filePath = join(tmpDir, 'append_missing.txt');
      const { validPath } = await fs.appendFile(filePath, 'created by append\n');

      const { content } = await fs.readRaw(validPath);
      assert.strictEqual(content.toString('utf-8'), 'created by append\n');
    });

    it('TC-FUNC-048: appendFile appends to an existing file', async () => {
      const filePath = await writeTestFile(tmpDir, 'append_existing.txt', 'first\n');
      await fs.appendFile(filePath, 'second\n');

      const { content } = await fs.readRaw(filePath);
      assert.strictEqual(content.toString('utf-8'), 'first\nsecond\n');
    });

    it('TC-FUNC-049: appendFile keeps the existing inode and mode', async (t) => {
      // Windows stat cannot represent 0600 (chmod only toggles the readonly
      // bit), and its st_ino is not guaranteed stable across handles. POSIX
      // proves the no-temp-rename design; Windows gets it by construction —
      // fs.appendFile never creates a replacement file.
      if (process.platform === 'win32') return t.skip('POSIX-only inode/mode assertions');

      const filePath = await writeTestFile(tmpDir, 'append_inode_mode.txt', 'secret\n');
      await chmod(filePath, 0o600);
      const before = await stat(filePath);

      await fs.appendFile(filePath, 'more\n');

      const after = await stat(filePath);
      assert.strictEqual(after.ino, before.ino);
      assert.strictEqual(after.mode & 0o777, 0o600);
      const { content } = await fs.readRaw(filePath);
      assert.strictEqual(content.toString('utf-8'), 'secret\nmore\n');
    });

    it('TC-FUNC-050: appendFile follows an in-root symlink to its target', async (t) => {
      const target = await writeTestFile(tmpDir, 'append_link_target.txt', 't\n');
      const linkPath = join(tmpDir, 'append_link.txt');
      if (!(await trySymlink(target, linkPath, () => t.skip('symlink not permitted'), 'file')))
        return;

      await fs.appendFile(linkPath, 'appended\n');

      const { content } = await fs.readRaw(target);
      assert.strictEqual(content.toString('utf-8'), 't\nappended\n');
    });

    it('TC-FUNC-051: appendFile through an out-of-root symlink is denied', async (t) => {
      const outside = join(dirname(tmpDir), 'fsmcp_append_outside_target.txt');
      const linkPath = join(tmpDir, 'append_escape_link.txt');
      if (!(await trySymlink(outside, linkPath, () => t.skip('symlink not permitted'), 'file')))
        return;

      await assert.rejects(
        fs.appendFile(linkPath, 'nope'),
        fsErrorMatcher(ErrorCode.ACCESS_DENIED),
      );
    });

    it('TC-FUNC-052a: countFileLines matches countLines across the buffer boundary', async () => {
      // >64 KiB so the counter crosses its read-buffer boundary, with the
      // final line left unterminated to exercise the last-byte rule.
      const lines = Array.from({ length: 12000 }, (_, i) => `line-${String(i)}`);
      const filePath = await writeTestFile(tmpDir, 'count_lines_big.txt', lines.join('\n'));

      assert.strictEqual(await fs.countFileLines(filePath), lines.length);
    });

    it('TC-FUNC-052c: a NUL final byte counts as an unterminated line, not an empty file', async () => {
      const filePath = await writeTestFile(tmpDir, 'count_lines_nul.txt', 'x\n\0');

      assert.strictEqual(await fs.countFileLines(filePath), 2);
    });

    it('TC-FUNC-052d: a single physical line larger than the read buffer counts as 1 line', async () => {
      // Regression guard for the readLines() rewrite: FileHandle.readLines
      // decodes each physical line whole, so this ~200 KiB no-newline file
      // OOMs a multi-GB version of itself. The byte counter must not.
      const filePath = await writeTestFile(
        tmpDir,
        'count_lines_huge_line.txt',
        'x'.repeat(200 * 1024),
      );

      assert.strictEqual(await fs.countFileLines(filePath), 1);
    });

    it('TC-FUNC-049b: appendFile to a sensitive file is denied', async () => {
      const envPath = join(tmpDir, '.env');
      await writeTestFile(tmpDir, '.env', 'SECRET=1\n');

      await assert.rejects(
        fs.appendFile(envPath, 'LEAKED=1\n'),
        fsErrorMatcher(ErrorCode.ACCESS_DENIED),
      );
      // Verify with plain node fs — the guarded read would block on .env too.
      assert.strictEqual(await readFile(envPath, 'utf-8'), 'SECRET=1\n');
    });

    it('TC-FUNC-049c: appendFile through an in-root symlink to a sensitive file is denied', async (t) => {
      const target = await writeTestFile(tmpDir, '.env', 'SECRET=1\n');
      const linkPath = join(tmpDir, 'env_link');
      if (!(await trySymlink(target, linkPath, () => t.skip('symlink not permitted'), 'file')))
        return;

      await assert.rejects(
        fs.appendFile(linkPath, 'LEAKED=1\n'),
        fsErrorMatcher(ErrorCode.ACCESS_DENIED),
      );
      assert.strictEqual(await readFile(target, 'utf-8'), 'SECRET=1\n');
    });

    it('TC-FUNC-047b: appendFile with an aborted signal writes nothing', async () => {
      const filePath = await writeTestFile(tmpDir, 'append_abort.txt', 'stable\n');
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(fs.appendFile(filePath, 'discarded\n', { signal: controller.signal }));
      assert.strictEqual((await fs.readRaw(filePath)).content.toString('utf-8'), 'stable\n');
    });

    it('TC-FUNC-047c: an aborted append to a missing file creates nothing', async () => {
      // 'a' mode creates the target on open; the abort check must precede the
      // open or a rejected call still leaves a new empty file behind.
      const filePath = join(tmpDir, 'append_abort_missing.txt');
      const controller = new AbortController();
      controller.abort();

      await assert.rejects(fs.appendFile(filePath, 'nope\n', { signal: controller.signal }));
      await assert.rejects(stat(filePath), (err: unknown) => {
        assert(isFsError(err) || (err as NodeJS.ErrnoException).code === 'ENOENT');
        return true;
      });
    });

    it('TC-FUNC-047d: an abort landing mid-rename still reports the committed write', async () => {
      const filePath = await writeTestFile(tmpDir, 'commit_race.txt', 'old\n');
      const controller = new AbortController();
      const originalRename = fsPromises.rename;
      // The real rename completes, THEN the signal fires — before the rename's
      // promise settles to its caller. Racing that promise against the signal
      // would reject even though the file was already replaced.
      mock.method(fsPromises, 'rename', async (from: PathLike, to: PathLike): Promise<void> => {
        await originalRename(from, to);
        controller.abort(new Error('late abort'));
      });
      syncBuiltinESMExports();
      try {
        await fs.writeFile(filePath, 'new\n', { signal: controller.signal });
      } finally {
        mock.restoreAll();
        syncBuiltinESMExports();
      }
      assert.strictEqual(await readFile(filePath, 'utf-8'), 'new\n');
      const leftovers = (await readdir(dirname(filePath))).filter((name) =>
        name.startsWith('commit_race.txt.'),
      );
      assert.deepStrictEqual(leftovers, [], 'no temp file may be left behind');
    });

    it('TC-FUNC-047e: an abort before the rename leaves the target untouched', async () => {
      const filePath = await writeTestFile(tmpDir, 'commit_precheck.txt', 'old\n');
      const controller = new AbortController();
      const originalWriteFile = fsPromises.writeFile;
      mock.method(
        fsPromises,
        'writeFile',
        async (...args: Parameters<typeof fsPromises.writeFile>): Promise<void> => {
          await originalWriteFile(...args);
          controller.abort(new Error('abort before commit'));
        },
      );
      syncBuiltinESMExports();
      try {
        await assert.rejects(
          fs.writeFile(filePath, 'new\n', { signal: controller.signal }),
          /abort before commit/,
        );
      } finally {
        mock.restoreAll();
        syncBuiltinESMExports();
      }
      assert.strictEqual(await readFile(filePath, 'utf-8'), 'old\n');
      const leftovers = (await readdir(dirname(filePath))).filter((name) =>
        name.startsWith('commit_precheck.txt.'),
      );
      assert.deepStrictEqual(leftovers, [], 'the temp file must be cleaned up');
    });

    it('TC-FUNC-052b: countFileLines handles empty and trailing-newline files', async () => {
      const emptyPath = await writeTestFile(tmpDir, 'count_lines_empty.txt', '');
      assert.strictEqual(await fs.countFileLines(emptyPath), 0);

      const terminatedPath = await writeTestFile(tmpDir, 'count_lines_term.txt', 'a\nb\n');
      assert.strictEqual(await fs.countFileLines(terminatedPath), 2);
    });

    it('TC-FUNC-052e: countFileLines counts LF only — a CRLF file is not double-counted', async () => {
      // Guards against a CR-counting "fix" for old-Mac files: every line is
      // terminated by a CR too, so counting both terminators doubles the
      // line count of the CRLF text files this server runs against on Windows.
      const filePath = await writeTestFile(tmpDir, 'count_lines_crlf.txt', 'a\r\nb\r\nc');

      assert.strictEqual(await fs.countFileLines(filePath), 3);
    });

    it('TC-FUNC-053: appendFile to a non-regular file is rejected before the open', async () => {
      // 'a' on a FIFO blocks POSIX until a reader appears, unabortable; a
      // directory is the cross-platform stand-in for "target is not a file".
      await assert.rejects(fs.appendFile(tmpDir, 'nope\n'), fsErrorMatcher(ErrorCode.NOT_FILE));
    });

    it('TC-FUNC-054: buildWrittenFileMeta omits the URI over the text cap and on a dry run', () => {
      // An edit or patch can push a readable file past the text-size cap;
      // a resourceUri the store's readRaw would reject with TOO_LARGE must
      // never be advertised.
      const huge = 'x'.repeat(10 * 1024 * 1024 + 1);
      const meta = buildWrittenFileMeta({
        validPath: join(tmpDir, 'huge.txt'),
        content: huge,
      });
      assert.strictEqual(meta.size, huge.length);
      assert.strictEqual(meta.resourceUri, undefined);
      assert.strictEqual(meta.resourceLink, undefined);

      const small = buildWrittenFileMeta({
        validPath: join(tmpDir, 'small.txt'),
        content: 'hi',
      });
      assert.ok(small.resourceUri, 'under the cap the URI is advertised');

      // A dry run describes the would-be content but advertises nothing.
      const dry = buildWrittenFileMeta({
        validPath: join(tmpDir, 'small.txt'),
        content: 'hi',
        dryRun: true,
      });
      assert.strictEqual(dry.size, 2);
      assert.strictEqual(dry.resourceUri, undefined);
    });

    it('written file links preserve the size boundary, unknown size, and dry-run gates', () => {
      const path = join(tmpDir, 'links.txt');
      const maxSize = getMaxTextFileSize();
      const linked = writtenFileLinks(path, 'text/plain', maxSize);
      assert.ok(linked.resourceUri);
      assert.deepStrictEqual(linked.resourceLink, {
        type: 'resource_link',
        uri: linked.resourceUri,
        name: 'links.txt',
        mimeType: 'text/plain',
        size: maxSize,
        annotations: { audience: ['user', 'assistant'] },
      });
      const stamped = writtenFileLinks(path, 'text/plain', 10, false, '2026-01-02T03:04:05.000Z');
      assert.deepStrictEqual(
        (stamped.resourceLink as { annotations?: { lastModified?: string } }).annotations,
        { audience: ['user', 'assistant'], lastModified: '2026-01-02T03:04:05.000Z' },
      );
      for (const size of [undefined, maxSize + 1]) {
        assert.deepStrictEqual(writtenFileLinks(path, 'text/plain', size), {
          resourceUri: undefined,
          resourceLink: undefined,
        });
      }
      assert.deepStrictEqual(writtenFileLinks(path, 'text/plain', 0, true), {
        resourceUri: undefined,
        resourceLink: undefined,
      });
    });
  });

  describe('Stat metadata (TC-FUNC-031–034)', () => {
    it('TC-FUNC-031: statDetailed on a file returns stats and isSymlink=false', async () => {
      const filePath = await writeTestFile(tmpDir, 'stat_file.txt', 'stat metadata test');
      const detail = await fs.statDetailed(filePath);

      assert.strictEqual(detail.isSymlink, false);
      assert.strictEqual(detail.stats.isFile(), true);
      assert.strictEqual(detail.stats.isDirectory(), false);
      assert.strictEqual(detail.stats.size, Buffer.byteLength('stat metadata test'));
    });

    it('TC-FUNC-032: statDetailed on a dir returns stats.isDirectory()=true', async () => {
      const dirPath = join(tmpDir, 'stat_test_directory');
      await fs.mkdir(dirPath);

      const detail = await fs.statDetailed(dirPath);

      assert.strictEqual(detail.isSymlink, false);
      assert.strictEqual(detail.stats.isDirectory(), true);
      assert.strictEqual(detail.stats.isFile(), false);
    });

    it('lstat propagates an already-aborted signal', async () => {
      const filePath = await writeTestFile(tmpDir, 'aborted-lstat.txt', 'content');
      const reason = new Error('lstat aborted');
      const controller = new AbortController();
      controller.abort(reason);

      await assert.rejects(fs.lstat(filePath, { signal: controller.signal }), (error) => {
        assert.strictEqual(error, reason);
        return true;
      });
    });
  });

  describe('Search & Glob (TC-FUNC-039–046)', () => {
    it('TC-FUNC-039: searchFiles with pattern matching filters files', async () => {
      await writeTestFile(tmpDir, 'search_dir/moduleA.ts', 'export const a = 1;');
      await writeTestFile(tmpDir, 'search_dir/moduleB.ts', 'export const b = 2;');
      await writeTestFile(tmpDir, 'search_dir/notes.txt', 'some notes');
      await writeTestFile(tmpDir, 'search_dir/sub/moduleC.ts', 'export const c = 3;');
      await writeTestFile(tmpDir, 'search_dir/sub/readme.txt', 'readme doc');

      const searchDir = join(tmpDir, 'search_dir');

      const tsResults = await searchFiles(searchDir, '**/*.ts', {}, ctx.pathGuard);
      assert.strictEqual(tsResults.results.length, 3);
      assert.ok(tsResults.results.every((r) => r.path.endsWith('.ts')));

      const txtResults = await searchFiles(searchDir, '**/*.txt', {}, ctx.pathGuard);
      assert.strictEqual(txtResults.results.length, 2);
      assert.ok(txtResults.results.every((r) => r.path.endsWith('.txt')));
    });

    it("TC-FUNC-039b: searchFiles sortBy 'name' orders by basename, not full path", async () => {
      await writeTestFile(tmpDir, 'sort_dir/zzz/alpha.ts', '// a');
      await writeTestFile(tmpDir, 'sort_dir/aaa/omega.ts', '// o');

      const sortDir = join(tmpDir, 'sort_dir');
      const byName = await searchFiles(sortDir, '**/*.ts', { sortBy: 'name' }, ctx.pathGuard);
      assert.deepStrictEqual(
        byName.results.map((r) => basename(r.path)),
        ['alpha.ts', 'omega.ts'],
      );

      const byPath = await searchFiles(sortDir, '**/*.ts', {}, ctx.pathGuard);
      assert.deepStrictEqual(
        byPath.results.map((r) => basename(r.path)),
        ['omega.ts', 'alpha.ts'],
      );
    });

    it('TC-FUNC-040: searchContent matches literal patterns across files', async () => {
      const searchContentDir = join(tmpDir, 'search_content_dir');
      await writeTestFile(
        searchContentDir,
        'file1.txt',
        'First line\nTARGET_LITERAL_STRING in file1\nThird line',
      );
      await writeTestFile(searchContentDir, 'file2.txt', 'No match here\nStill nothing');
      await writeTestFile(
        searchContentDir,
        'file3.txt',
        'TARGET_LITERAL_STRING at line 1\nAnother TARGET_LITERAL_STRING line',
      );

      const outcome = await searchContent(
        searchContentDir,
        'TARGET_LITERAL_STRING',
        { isRegex: false },
        ctx.pathGuard,
      );

      assert.strictEqual(outcome.summary.filesMatched, 2);
      assert.strictEqual(outcome.summary.matchingLines, 3);
      assert.strictEqual(outcome.matches.length, 3);
      assert.ok(outcome.matches.every((m) => m.content.includes('TARGET_LITERAL_STRING')));
    });

    it('searchContent skips binary files, keeps Latin-1 text, and strips CR', async () => {
      const dir = join(tmpDir, 'search_binary_dir');
      await writeTestFile(dir, 'crlf.txt', 'NEEDLE;\r\nnext\r\n');
      await writeFile(
        join(dir, 'blob.bin'),
        Buffer.from([0x00, 0x4e, 0x45, 0x45, 0x44, 0x4c, 0x45, 0x00]),
      );
      await writeFile(join(dir, 'latin1.txt'), Buffer.from('caf\xe9 NEEDLE\n', 'latin1'));

      const outcome = await searchContent(dir, 'NEEDLE;$', { isRegex: true }, ctx.pathGuard);
      assert.strictEqual(outcome.matches.length, 1);
      assert.strictEqual(basename(outcome.matches[0]?.file ?? ''), 'crlf.txt');
      assert.strictEqual(outcome.matches[0]?.content, 'NEEDLE;');

      const all = await searchContent(dir, 'NEEDLE', { isRegex: false }, ctx.pathGuard);
      assert.deepStrictEqual(all.matches.map((m) => basename(m.file)).sort(), [
        'crlf.txt',
        'latin1.txt',
      ]);
      assert.strictEqual(all.summary.skippedBinary, 1);
    });

    it('an aborted search over a tree with no match reports timeout, not a complete scan', async () => {
      const dir = join(tmpDir, 'search_aborted_dir');
      for (let i = 0; i < 20; i++)
        await fs.mkdir(join(dir, `d${String(i)}`, 'inner'), { recursive: true });
      const signal = AbortSignal.abort(new Error('deadline'));

      const files = await searchFiles(dir, '**/*.nomatch', { signal }, ctx.pathGuard);
      assert.strictEqual(files.results.length, 0);
      assert.strictEqual(files.summary.stoppedReason, 'timeout');
      assert.strictEqual(files.summary.truncated, true);

      const content = await searchContent(dir, 'NEEDLE', { isRegex: false, signal }, ctx.pathGuard);
      assert.strictEqual(content.matches.length, 0);
      assert.strictEqual(content.summary.stoppedReason, 'timeout');
    });
  });

  describe('Delete guards (TC-FUNC-018–020)', () => {
    it('TC-FUNC-018: hasChildrenUnchecked distinguishes empty vs non-empty directories', async () => {
      const emptyDir = join(tmpDir, 'empty_dir_guard');
      await fs.mkdir(emptyDir);

      const emptyHasChildren = await fs.hasChildrenUnchecked(emptyDir);
      assert.strictEqual(emptyHasChildren, false);

      const nonEmptyDir = join(tmpDir, 'non_empty_dir_guard');
      await fs.mkdir(nonEmptyDir);
      await writeTestFile(nonEmptyDir, 'child.txt', 'child content');

      const nonEmptyHasChildren = await fs.hasChildrenUnchecked(nonEmptyDir);
      assert.strictEqual(nonEmptyHasChildren, true);
    });

    it('TC-FUNC-019: rm with recursive=true removes non-empty directory', async () => {
      const dirToDelete = join(tmpDir, 'dir_to_delete');
      await fs.mkdir(dirToDelete);
      await writeTestFile(dirToDelete, 'file1.txt', 'f1');
      await writeTestFile(dirToDelete, 'sub/file2.txt', 'f2');

      await fs.rm(dirToDelete, { recursive: true, force: true });

      await assert.rejects(() => fs.stat(dirToDelete), fsErrorMatcher(ErrorCode.NOT_FOUND));
    });
  });

  describe('Invalid setting warnings (TC-FUNC-019b)', () => {
    it('TC-FUNC-019b: a rejected numeric setting warns once and is not gated by --log-level', async (t) => {
      await withEnv({ FS_LOG_LEVEL: 'error', FS_MAX_FILE_SIZE: 'not-a-number' }, () => {
        const collected: string[] = [];
        t.mock.method(console, 'error', (...args: unknown[]) => {
          collected.push(args.map(String).join(' '));
        });

        const first = getMaxTextFileSize();
        const second = getMaxTextFileSize();

        assert.strictEqual(first, 10 * 1024 * 1024, 'falls back to the documented default');
        assert.strictEqual(second, first);

        const warnings = collected.filter((line) =>
          line.includes('Invalid FS_MAX_FILE_SIZE value'),
        );
        // Once per (setting, value), not once per call — and it reaches stderr
        // despite FS_LOG_LEVEL=error, which used to suppress this one warning
        // while leaving FS_ALLOW_SENSITIVE and FS_LOG_LEVEL typos visible.
        assert.strictEqual(
          warnings.length,
          1,
          `expected one warning, got ${JSON.stringify(collected)}`,
        );
        assert.match(
          warnings[0] ?? '',
          /^\[warning\] Invalid FS_MAX_FILE_SIZE value: not-a-number \(must be 1048576-104857600\)\. Using default: 10485760$/,
        );
      });
    });
  });
});

describe('H4: a symlink swapped onto a validated path cannot escape the sandbox', () => {
  let base: string;
  let root: string;
  let secret: string;
  let ctx: FilesystemServerContext;
  let fs: GuardedFileSystem;
  let pair: Awaited<ReturnType<typeof createTestClientPair>>;

  before(async () => {
    base = await createTestRoot();
    root = join(base, 'root');
    await mkdir(root, { recursive: true });
    secret = join(base, 'OUTSIDE_SECRET.txt'); // a sibling of the root, never allowed
    await writeFile(secret, 'TOP_SECRET\n');
    ctx = await createTestServer([root]);
    fs = new GuardedFileSystem(ctx.pathGuard);
    pair = await createTestClientPair([root]);
  });
  after(async () => {
    await pair.close();
    ctx.disposeRuntimeState();
    await ctx.mcp.close();
    await cleanupTestRoot(base);
  });

  it('a concurrent file↔symlink flip never leaks out-of-root content or writes outside', async (t) => {
    if (process.platform === 'win32') return t.skip('POSIX symlink race');
    const victim = join(root, 'victim.txt');
    const reg = join(root, 'victim.reg');
    const lnk = join(root, 'victim.lnk');
    await writeFile(victim, 'in-root\n');

    // Flip victim between a regular file and a symlink-to-secret via rename,
    // so it is never briefly absent — the exact TOCTOU window.
    let stop = false;
    const flipper = (async () => {
      while (!stop) {
        try {
          await rm(lnk, { force: true });
          await symlink(secret, lnk);
          await rename(lnk, victim);
          await writeFile(reg, 'in-root\n');
          await rename(reg, victim);
        } catch {
          /* races on the temp names are expected */
        }
      }
    })();

    try {
      for (let i = 0; i < 400; i++) {
        let rawContent: string | undefined;
        try {
          rawContent = (await fs.readRaw(victim)).content.toString('utf-8');
        } catch {
          /* ELOOP / ACCESS_DENIED / NOT_FOUND are all acceptable refusals */
        }
        if (rawContent !== undefined) {
          assert.ok(!rawContent.includes('TOP_SECRET'), 'a read must never return the secret');
        }
        let textContent: string | undefined;
        try {
          textContent = (await fs.readFile(victim, { kind: 'full' })).content;
        } catch {
          /* ELOOP / ACCESS_DENIED / NOT_FOUND are all acceptable refusals */
        }
        if (textContent !== undefined) {
          assert.ok(
            !textContent.includes('TOP_SECRET'),
            'a text read must never return the secret',
          );
        }
        let searched: Awaited<ReturnType<typeof searchContent>> | undefined;
        try {
          searched = await searchContent(
            root,
            'TOP_SECRET',
            { explicitFile: victim },
            ctx.pathGuard,
          );
        } catch {
          /* refusals are fine */
        }
        if (searched !== undefined) {
          assert.strictEqual(searched.matches.length, 0, 'a search must never match the secret');
        }
        try {
          await fs.appendFile(victim, 'x\n');
        } catch {
          /* refusals are fine */
        }
      }
    } finally {
      stop = true;
      await flipper;
    }

    // The decisive assertion: no append escaped into the out-of-root secret.
    assert.strictEqual(await readFile(secret, 'utf-8'), 'TOP_SECRET\n');
  });

  it('an ancestor directory swapped for a symlink never leaks through any read path', async (t) => {
    // #assertFdWithinRoots reads /proc/self/fd, so only Linux re-checks an
    // ancestor; elsewhere this swap is the residual path.ts's TOCTOU note names.
    if (process.platform !== 'linux') return t.skip('fd re-check is Linux-only');
    const outsideDir = join(base, 'outside-dir');
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, 'victim.txt'), 'TOP_SECRET\n'.repeat(5));
    const dir = join(root, 'swapdir');
    const parked = join(root, 'swapdir.real');
    await mkdir(dir, { recursive: true });
    const victim = join(dir, 'victim.txt');
    await writeFile(victim, 'in-root\n');

    // Each op in its own try, so a lost race heals on the next lap instead
    // of wedging the flip: dir is the real directory, then a symlink to
    // outsideDir, then the real directory again.
    const step = async (op: () => Promise<unknown>): Promise<void> => {
      try {
        await op();
      } catch {
        /* races are expected */
      }
    };
    let stop = false;
    const flipper = (async () => {
      while (!stop) {
        await step(() => rename(dir, parked));
        await step(() => symlink(outsideDir, dir));
        await step(() => rm(dir));
        await step(() => rename(parked, dir));
      }
    })();

    try {
      for (let i = 0; i < 400; i++) {
        let searched: Awaited<ReturnType<typeof searchContent>> | undefined;
        try {
          searched = await searchContent(
            root,
            'TOP_SECRET',
            { explicitFile: victim },
            ctx.pathGuard,
          );
        } catch {
          /* refusals are fine */
        }
        if (searched !== undefined) {
          assert.strictEqual(searched.matches.length, 0, 'a search must never match the secret');
        }
        const batch = await pair.client.callTool({
          name: 'read',
          arguments: { paths: [victim] },
        });
        assert.ok(
          !JSON.stringify(batch).includes('TOP_SECRET'),
          'a batch read must never return the secret',
        );
        let sample: Buffer | undefined;
        try {
          sample = await fs.readLeadingSample(victim);
        } catch {
          /* refusals are fine */
        }
        if (sample !== undefined) {
          assert.ok(
            !sample.toString('utf-8').includes('TOP_SECRET'),
            'a MIME sample must never come from the secret',
          );
        }
        // The secret has 5 lines and the in-root victim 1, so 5 can only
        // come from the outside file.
        let lines: number | undefined;
        try {
          lines = await fs.countFileLines(victim);
        } catch {
          /* refusals are fine */
        }
        if (lines !== undefined) {
          assert.notStrictEqual(lines, 5, 'a line count must never describe the secret');
        }
      }
    } finally {
      stop = true;
      await flipper;
    }
  });

  it('a legitimate in-root symlink still reads and appends to its target', async (t) => {
    const target = join(root, 'legit-target.txt');
    const link = join(root, 'legit-link.txt');
    await writeFile(target, 'hello\n');
    if (!(await trySymlink(target, link, () => t.skip('symlinks not permitted'), 'file'))) return;

    const { content } = await fs.readRaw(link);
    assert.strictEqual(content.toString('utf-8'), 'hello\n');
    await fs.appendFile(link, 'more\n');
    assert.strictEqual(await readFile(target, 'utf-8'), 'hello\nmore\n');
  });

  describe('aborted read streams', () => {
    let tmpDir: string;
    before(async () => {
      tmpDir = await createTestRoot();
    });
    after(async () => {
      await cleanupTestRoot(tmpDir);
    });

    const isAbort = (err: unknown): boolean =>
      ['TimeoutError', 'AbortError'].includes((err as { name?: string }).name ?? '');

    // Node double-emits a pre-aborted signal's error; the stray copy is uncaught.
    async function withUncaughtWatch(body: () => Promise<void>): Promise<void> {
      const uncaught: unknown[] = [];
      const onUncaught = (error: unknown): void => {
        uncaught.push(error);
      };
      process.on('uncaughtException', onUncaught);
      try {
        await body();
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.deepStrictEqual(uncaught, []);
      } finally {
        process.off('uncaughtException', onUncaught);
      }
    }

    const aborted = (): AbortSignal => {
      const controller = new AbortController();
      controller.abort(new DOMException('test timeout', 'TimeoutError'));
      return controller.signal;
    };

    it('a pre-aborted signal rejects without an uncaught exception', async () => {
      const file = await writeTestFile(tmpDir, 'pre-aborted.txt', 'line one\nline two\n');
      await withUncaughtWatch(async () => {
        const handle = await fsPromises.open(file, 'r');
        try {
          await assert.rejects(readFileBufferWithLimit(handle, 1024, file, aborted()), isAbort);
        } finally {
          await handle.close();
        }
      });
    });

    it('a pre-aborted range read rejects without an uncaught exception', async () => {
      const file = await writeTestFile(tmpDir, 'pre-aborted-range.txt', 'line one\nline two\n');
      await withUncaughtWatch(async () => {
        const stats = await fsPromises.stat(file);
        await assert.rejects(
          readFileWithStats(
            file,
            file,
            stats,
            { kind: 'range', start: 1, end: 1, signal: aborted() },
            () => fsPromises.open(file, 'r'),
          ),
          isAbort,
        );
      });
    });
  });
});
