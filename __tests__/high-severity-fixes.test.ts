// Regression tests for the six high-severity bugs found in the 2026-10 bug
// hunt and fixed on this branch:
//   H1 regex scans are interruptible and bounded (no server hang)
//   H2 concurrent / aliased writes do not silently lose data
//   H3 a move batch whose entries overlap is refused, not partially destroyed
//   H5 a read whose encoded result would blow the stdio buffer errors cleanly
//   H6 a single over-long line is reported skipped, not a false empty / OOM
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { GuardedFileSystem } from '../src/core/fs.ts';
import { RE2_MAX_INPUT_BYTES, searchContent } from '../src/core/search.ts';
import type { FilesystemServerContext } from '../src/server.ts';
import {
  cleanupTestRoot,
  createStdioClient,
  createTestClientPair,
  createTestHttpHarness,
  createTestRoot,
  createTestServer,
  firstTextBlock,
  trySymlink,
  writeTestFile,
} from './helpers.ts';

describe('High-severity bug-hunt regressions', () => {
  let tmpDir: string;
  let ctx: FilesystemServerContext;
  let pair: Awaited<ReturnType<typeof createTestClientPair>>;

  before(async () => {
    tmpDir = await createTestRoot();
    ctx = await createTestServer([tmpDir]);
    pair = await createTestClientPair([tmpDir]);
  });
  after(async () => {
    await pair.close();
    ctx.disposeRuntimeState();
    await ctx.mcp.close();
    await cleanupTestRoot(tmpDir);
  });

  describe('H2: concurrent and aliased writes keep every change', () => {
    it('30 concurrent edit calls on one file all apply (no lost updates)', async () => {
      const file = join(tmpDir, 'counters.txt');
      const n = 30;
      await writeFile(
        file,
        Array.from({ length: n }, (_, i) => `slot ${String(i)} = 0`).join('\n') + '\n',
      );
      const calls = Array.from({ length: n }, (_, i) =>
        pair.client.callTool({
          name: 'edit',
          arguments: {
            path: file,
            edits: [{ oldText: `slot ${String(i)} = 0`, newText: `slot ${String(i)} = 1` }],
          },
        }),
      );
      const results = await Promise.all(calls);
      assert.ok(
        results.every((r) => r.isError !== true),
        'every concurrent edit should succeed',
      );
      const after = await readFile(file, 'utf-8');
      for (let i = 0; i < n; i++) {
        assert.ok(after.includes(`slot ${String(i)} = 1`), `slot ${String(i)} must be updated`);
      }
      assert.ok(!after.includes('= 0'), 'no slot should keep its original value');
    });

    it('aliased creates never overwrite a file that appeared after planning', async (t) => {
      const file = join(tmpDir, 'concurrent-create.txt');
      const alias = join(tmpDir, 'create-alias');
      if (!(await trySymlink(tmpDir, alias, () => t.skip('symlinks not permitted')))) return;
      const result = await pair.client.callTool({
        name: 'create',
        arguments: {
          files: [
            { path: file, content: 'first' },
            { path: join(alias, 'concurrent-create.txt'), content: 'second' },
          ],
        },
      });
      const structured = result.structuredContent as {
        files?: unknown[];
        failures?: unknown[];
      };
      assert.strictEqual(structured.files?.length, 1, JSON.stringify(result));
      assert.strictEqual(structured.failures?.length, 1);
      const contents = await readFile(file, 'utf-8');
      assert.ok(contents === 'first' || contents === 'second');
    });

    it('a batch naming one file through a symlinked parent applies both entries', async (t) => {
      const file = join(tmpDir, 'aliased.txt');
      await writeFile(file, 'AAA\nBBB\n');
      const alias = join(tmpDir, 'aliasdir');
      if (!(await trySymlink(tmpDir, alias, () => t.skip('symlinks not permitted')))) return;

      const result = await pair.client.callTool({
        name: 'edit',
        arguments: {
          files: [
            { path: file, edits: [{ oldText: 'AAA', newText: 'XXX' }] },
            { path: join(alias, 'aliased.txt'), edits: [{ oldText: 'BBB', newText: 'YYY' }] },
          ],
        },
      });
      assert.notStrictEqual(result.isError, true);
      const after = await readFile(file, 'utf-8');
      assert.ok(after.includes('XXX') && after.includes('YYY'), `both edits must land: ${after}`);
    });
  });

  describe('H3: an overlapping move batch is refused with no data loss', () => {
    it('a swap [A->B, B->A] is refused and both files survive', async () => {
      const a = join(tmpDir, 'swapA');
      const b = join(tmpDir, 'swapB');
      await writeFile(a, 'AAA\n');
      await writeFile(b, 'BBB\n');
      const result = await pair.client.callTool({
        name: 'move',
        arguments: {
          moves: [
            { source: a, destination: b },
            { source: b, destination: a },
          ],
        },
      });
      assert.strictEqual(result.isError, true, 'a doomed swap is a total failure');
      assert.strictEqual(await readFile(a, 'utf-8'), 'AAA\n');
      assert.strictEqual(await readFile(b, 'utf-8'), 'BBB\n');
    });

    it('a chain [B->C, A->B] is refused and no file is destroyed', async () => {
      const a = join(tmpDir, 'chainA');
      const b = join(tmpDir, 'chainB');
      const c = join(tmpDir, 'chainC');
      await writeFile(a, 'AAA\n');
      await writeFile(b, 'BBB\n');
      const result = await pair.client.callTool({
        name: 'move',
        arguments: {
          moves: [
            { source: b, destination: c },
            { source: a, destination: b },
          ],
        },
      });
      assert.strictEqual(result.isError, true);
      assert.strictEqual(await readFile(a, 'utf-8'), 'AAA\n');
      assert.strictEqual(await readFile(b, 'utf-8'), 'BBB\n');
      await assert.rejects(readFile(c, 'utf-8'), 'C must never be created');
    });

    it('independent moves in one batch still run concurrently', async () => {
      const x = join(tmpDir, 'indX');
      const y = join(tmpDir, 'indY');
      await writeFile(x, 'X\n');
      await writeFile(y, 'Y\n');
      const result = await pair.client.callTool({
        name: 'move',
        arguments: {
          moves: [
            { source: x, destination: join(tmpDir, 'indX2') },
            { source: y, destination: join(tmpDir, 'indY2') },
          ],
        },
      });
      assert.notStrictEqual(result.isError, true);
      assert.strictEqual(await readFile(join(tmpDir, 'indX2'), 'utf-8'), 'X\n');
      assert.strictEqual(await readFile(join(tmpDir, 'indY2'), 'utf-8'), 'Y\n');
    });
  });

  describe('H1: edit ignoreWhitespace is bounded on a dense match', () => {
    it(
      'a short oldText matching thousands of times fails ambiguous quickly',
      { timeout: 5000 },
      async () => {
        const file = join(tmpDir, 'dense.txt');
        await writeFile(file, 'a b\n'.repeat(20_000));
        const result = await pair.client.callTool({
          name: 'edit',
          arguments: {
            path: file,
            ignoreWhitespace: true,
            edits: [{ oldText: 'a b', newText: 'X' }],
          },
        });
        assert.strictEqual(result.isError, true, 'an ambiguous match is an error');
        assert.match(firstTextBlock(result).text ?? '', /matches at least \d+ places/i);

        const exact = await pair.client.callTool({
          name: 'edit',
          arguments: {
            path: file,
            edits: [{ oldText: 'a b', newText: 'X' }],
          },
        });
        assert.strictEqual(exact.isError, true, 'repeated exact matches are ambiguous too');
        assert.match(firstTextBlock(exact).text ?? '', /matches at least \d+ places/i);

        // Nothing should have been written.
        assert.strictEqual(await readFile(file, 'utf-8'), 'a b\n'.repeat(20_000));
      },
    );
  });

  describe('H1 + H6: core search is interruptible and guards over-long lines', () => {
    it('H6: a line past the RE2 input bound is reported skippedTooLarge, not a false empty, and later searches still work', async () => {
      const dir = join(tmpDir, 'oversized');
      const bigLine = 'a'.repeat(RE2_MAX_INPUT_BYTES + 1024); // one line over the bound
      await writeTestFile(dir, 'huge.txt', bigLine);
      await writeTestFile(dir, 'ok.txt', 'hello NEEDLE world\n');

      const outcome = await searchContent(dir, 'NEEDLE', { isRegex: false }, ctx.pathGuard);
      assert.strictEqual(outcome.summary.skippedTooLarge, 1, 'the huge-line file is skipped');
      assert.strictEqual(outcome.matches.length, 1, 'the ordinary file is still searched');

      // The wasm module is still alive for a second search in the same process.
      const again = await searchContent(dir, 'NEEDLE', { isRegex: false }, ctx.pathGuard);
      assert.strictEqual(again.matches.length, 1);
    });

    it('H1: an aborted search over a dense-match line resolves as timeout, not a hang', async () => {
      const dir = join(tmpDir, 'dense-line');
      await writeTestFile(dir, 'line.txt', 'needle\n'.repeat(200_000));
      const controller = new AbortController();
      const search = searchContent(
        dir,
        'needle',
        { isRegex: false, maxResults: 100_000, signal: controller.signal },
        ctx.pathGuard,
      );
      setTimeout(() => controller.abort(new DOMException('deadline', 'TimeoutError')), 50);
      const outcome = await search;
      assert.strictEqual(outcome.summary.stoppedReason, 'timeout');
      assert.ok(outcome.summary.truncated, 'an aborted scan is incomplete');
      assert.ok(outcome.summary.filesScanned > 0, 'the scan started before cancellation');
    });

    it(
      'H1: a live replace_text timeout never writes a partially spliced file',
      { timeout: 5000 },
      async (t) => {
        const file = join(tmpDir, 'dense-replace.txt');
        const original = 'a'.repeat(200_000) + '\n';
        await writeFile(file, original);
        t.mock.method(AbortSignal, 'timeout', () => {
          const controller = new AbortController();
          setTimeout(() => controller.abort(new DOMException('test timeout', 'TimeoutError')), 100);
          return controller.signal;
        });
        const result = await pair.client.callTool({
          name: 'replace_text',
          arguments: {
            path: file,
            searchPattern: 'a',
            replacement: 'b',
            isRegex: true,
            caseSensitive: true,
          },
        });
        assert.strictEqual((result._meta as { stoppedReason?: string }).stoppedReason, 'timeout');
        assert.strictEqual(await readFile(file, 'utf-8'), original);
      },
    );
  });

  describe('H5: a read whose encoded result exceeds the transport buffer errors cleanly', () => {
    let tmpDir: string;
    let harness: Awaited<ReturnType<typeof createStdioClient>>;

    before(async () => {
      tmpDir = await createTestRoot();
      harness = await createStdioClient(tmpDir);
    });
    after(async () => {
      await harness.close();
      await cleanupTestRoot(tmpDir);
    });

    it('a ~9.9 MiB full read fails TOO_LARGE and the connection survives', async () => {
      // Under the 10 MiB file-size limit (full read allowed), but every "\n"
      // doubles under JSON escaping, so the serialized result clears the SDK
      // client's 10 MiB ReadBuffer. Without the outbound cap this drops the
      // session; with it, a small TOO_LARGE comes back and head still works.
      const big = join(tmpDir, 'too-big-to-return.txt');
      await writeFile(big, 'line\n'.repeat(Math.floor((9.9 * 1024 * 1024) / 5)));

      const full = await harness.client.callTool({ name: 'read', arguments: { path: big } });
      assert.strictEqual(full.isError, true, JSON.stringify(full.content).slice(0, 200));
      assert.match(firstTextBlock(full).text ?? '', /TOO_LARGE/);
      assert.match(firstTextBlock(full).text ?? '', /head|tail|startLine/);

      const head = await harness.client.callTool({
        name: 'read',
        arguments: { path: big, head: 10 },
      });
      assert.notStrictEqual(head.isError, true, 'connection survived; head still works');
      assert.ok(firstTextBlock(head).text?.includes('line'));
    });

    it('the same ~9.9 MiB read still succeeds over HTTP, which has no ReadBuffer frame limit', async () => {
      // The stdio cap must not shrink what a direct HTTP read returns: HTTP
      // streams the response with no 10 MiB framing. This guards against the
      // cap being applied transport-blind.
      const httpTmp = await createTestRoot();
      const http = await createTestHttpHarness([httpTmp]);
      try {
        const big = join(httpTmp, 'big-over-http.txt');
        await writeFile(big, 'line\n'.repeat(Math.floor((9.9 * 1024 * 1024) / 5)));
        const result = await http.client.callTool({ name: 'read', arguments: { path: big } });
        assert.notStrictEqual(result.isError, true, 'HTTP returns the large read, not TOO_LARGE');
        assert.ok((firstTextBlock(result).text ?? '').startsWith('line\n'));
      } finally {
        await http.close();
        await cleanupTestRoot(httpTmp);
      }
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
  });
});
