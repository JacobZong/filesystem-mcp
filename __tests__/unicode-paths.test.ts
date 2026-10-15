import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { ErrorCode } from '../src/core/errors.ts';
import type { PathGuard } from '../src/core/path.ts';
import {
  cleanupTestRoot,
  createTestClientPair,
  createTestRoot,
  firstTextBlock,
  fsErrorMatcher,
  makeGuard,
  trySymlink,
  withEnv,
} from './helpers.ts';

// Issue #101. Names are built from escapes so the source file's own
// normalization cannot change what lands on disk.
const NFC_CAFE = 'caf\u00e9';
const NFD_CAFE = 'cafe\u0301';
const NBSP_NAME = 'a\u00a0b.txt';
const NNBSP_NAME = 'a\u202fb.txt';
const ASCII_NAME = 'a b.txt';
const NNBSP_SHOT = 'shot\u202fPM.txt';
const ASCII_SHOT = 'shot PM.txt';

/**
 * True when this filesystem stores `NFD_CAFE` and `NFC_CAFE` as two names
 * (ext4, NTFS). APFS and HFS+ treat them as one, so the "on disk differs"
 * premise of the NFC/NFD cases does not hold there.
 */
async function isNormalizationSensitive(root: string): Promise<boolean> {
  const probe = join(root, 'norm-probe');
  await mkdir(probe);
  await writeFile(join(probe, NFD_CAFE), '');
  try {
    await readFile(join(probe, NFC_CAFE));
    return false;
  } catch {
    return true;
  }
}

describe('Unicode-equivalent path lookup (#101)', () => {
  let root: string;

  beforeEach(async () => {
    root = await createTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(root);
  });

  describe('PathGuard', () => {
    let guard: PathGuard;

    beforeEach(async () => {
      guard = await makeGuard([root]);
    });

    it('reads through an NFC spelling of an NFD directory', async (t) => {
      if (!(await isNormalizationSensitive(root))) {
        t.skip('filesystem is normalization-insensitive');
        return;
      }
      await mkdir(join(root, NFD_CAFE));
      await writeFile(join(root, NFD_CAFE, 'a.txt'), 'nfd');
      const resolved = await guard.validateExistingPath(join(root, NFC_CAFE, 'a.txt'));
      assert.strictEqual(resolved, join(root, NFD_CAFE, 'a.txt'));
    });

    it('reads a U+202F name the request spells with U+0020', async () => {
      await writeFile(join(root, NNBSP_SHOT), 'shot');
      const resolved = await guard.validateExistingPath(join(root, ASCII_SHOT));
      assert.strictEqual(resolved, join(root, NNBSP_SHOT));
    });

    it('reports the on-disk spelling, not a symlink', async () => {
      await writeFile(join(root, NNBSP_SHOT), 'shot');
      const details = await guard.validateExistingPathDetailed(join(root, ASCII_SHOT));
      assert.deepStrictEqual(details, {
        requestedPath: join(root, NNBSP_SHOT),
        resolvedPath: join(root, NNBSP_SHOT),
        isSymlink: false,
      });
    });

    it('prefers the exact spelling when both are on disk', async () => {
      await writeFile(join(root, ASCII_NAME), 'space');
      await writeFile(join(root, NBSP_NAME), 'nbsp');
      assert.strictEqual(
        await guard.validateExistingPath(join(root, ASCII_NAME)),
        join(root, ASCII_NAME),
      );
      assert.strictEqual(
        await guard.validateExistingPath(join(root, NBSP_NAME)),
        join(root, NBSP_NAME),
      );
    });

    it('refuses a name that matches two entries and neither exactly', async () => {
      await writeFile(join(root, NBSP_NAME), 'nbsp');
      await writeFile(join(root, NNBSP_NAME), 'nnbsp');
      await assert.rejects(
        guard.validateExistingPath(join(root, ASCII_NAME)),
        fsErrorMatcher(ErrorCode.INVALID_INPUT, /Ambiguous Unicode path component.*\\u00a0/),
      );
      await assert.rejects(
        guard.validatePathForWrite(join(root, ASCII_NAME)),
        fsErrorMatcher(ErrorCode.INVALID_INPUT, /Ambiguous Unicode path component/),
      );
    });

    it('keeps NOT_FOUND when nothing matches', async () => {
      await assert.rejects(
        guard.validateExistingPath(join(root, 'no such file.txt')),
        fsErrorMatcher(ErrorCode.NOT_FOUND),
      );
    });

    it('never matches a component of the root itself', async () => {
      const top = await createTestRoot();
      try {
        await mkdir(join(top, 'my\u00a0root'));
        await writeFile(join(top, 'my\u00a0root', 'a.txt'), 'x');
        const narrow = await makeGuard([join(top, 'my root')]);
        await assert.rejects(
          narrow.validateExistingPath(join(top, 'my root', 'a.txt')),
          fsErrorMatcher(ErrorCode.ACCESS_DENIED),
        );
      } finally {
        await cleanupTestRoot(top);
      }
    });

    it('refuses a symlink reached by equivalence that escapes the root', async (t) => {
      const outside = await createTestRoot();
      try {
        await writeFile(join(outside, 'secret.txt'), 'outside');
        if (
          !(await trySymlink(outside, join(root, 'out\u00a0link'), () =>
            t.skip('symlink not permitted'),
          ))
        ) {
          return;
        }
        await assert.rejects(
          guard.validateExistingPath(join(root, 'out link', 'secret.txt')),
          fsErrorMatcher(ErrorCode.ACCESS_DENIED),
        );
        await assert.rejects(
          guard.validatePathForWrite(join(root, 'out link', 'new.txt')),
          fsErrorMatcher(ErrorCode.ACCESS_DENIED),
        );
        assert.deepStrictEqual(await readdir(outside), ['secret.txt']);
      } finally {
        await cleanupTestRoot(outside);
      }
    });

    it('applies the denylist to the on-disk spelling', async () => {
      await writeFile(join(root, 'secret\u202fnotes.txt'), 'secret');
      const denying = await withEnv({ FS_DENYLIST: 'secret\u202fnotes.txt' }, () =>
        makeGuard([root]),
      );
      await assert.rejects(
        denying.validateExistingPath(join(root, 'secret notes.txt')),
        fsErrorMatcher(ErrorCode.ACCESS_DENIED, /denylist/),
      );
      await assert.rejects(
        denying.validatePathForWrite(join(root, 'secret notes.txt')),
        fsErrorMatcher(ErrorCode.ACCESS_DENIED, /denylist/),
      );
    });

    it('writes into the existing NFD directory, not a new NFC sibling', async (t) => {
      if (!(await isNormalizationSensitive(root))) {
        t.skip('filesystem is normalization-insensitive');
        return;
      }
      await mkdir(join(root, NFD_CAFE));
      const target = await guard.validatePathForWrite(join(root, NFC_CAFE, 'new.txt'));
      assert.strictEqual(target, join(root, NFD_CAFE, 'new.txt'));
    });

    it('a write to a U+0020 spelling lands on the existing U+202F file', async () => {
      await writeFile(join(root, NNBSP_SHOT), 'shot');
      const target = await guard.validatePathForWrite(join(root, ASCII_SHOT));
      assert.strictEqual(target, join(root, NNBSP_SHOT));
    });
  });

  describe('through the tools', () => {
    it('create without overwrite asks before replacing the equivalent file', async () => {
      await writeFile(join(root, NNBSP_SHOT), 'shot');
      const pair = await createTestClientPair([root]);
      try {
        const create = await pair.client.callTool({
          name: 'create',
          arguments: { files: [{ path: join(root, ASCII_SHOT), content: 'again' }] },
        });
        assert.strictEqual(create.isError, true);
        assert.match(firstTextBlock(create).text ?? '', /overwrite: true/);
        assert.deepStrictEqual(await readdir(root), [NNBSP_SHOT]);
        assert.strictEqual(await readFile(join(root, NNBSP_SHOT), 'utf8'), 'shot');
      } finally {
        await pair.close();
      }
    });

    it('a move onto a separate lookalike file is not a rename in place', async () => {
      await writeFile(join(root, NBSP_NAME), 'nbsp');
      await writeFile(join(root, NNBSP_NAME), 'nnbsp');
      const pair = await createTestClientPair([root]);
      try {
        await pair.client.callTool({
          name: 'move',
          arguments: {
            moves: [{ source: join(root, NBSP_NAME), destination: join(root, NNBSP_NAME) }],
          },
        });
        assert.strictEqual(await readFile(join(root, NBSP_NAME), 'utf8'), 'nbsp');
        assert.strictEqual(await readFile(join(root, NNBSP_NAME), 'utf8'), 'nnbsp');
      } finally {
        await pair.close();
      }
    });

    it('a move that only changes the normalization form still renames', async (t) => {
      if (!(await isNormalizationSensitive(root))) {
        t.skip('filesystem is normalization-insensitive');
        return;
      }
      await writeFile(join(root, `${NFD_CAFE}.txt`), 'x');
      const pair = await createTestClientPair([root]);
      try {
        const move = await pair.client.callTool({
          name: 'move',
          arguments: {
            moves: [
              {
                source: join(root, `${NFD_CAFE}.txt`),
                destination: join(root, `${NFC_CAFE}.txt`),
              },
            ],
          },
        });
        assert.notStrictEqual(move.isError, true, firstTextBlock(move).text);
        const names = (await readdir(root)).filter((name) => name.endsWith('.txt'));
        assert.deepStrictEqual(names, [`${NFC_CAFE}.txt`]);
      } finally {
        await pair.close();
      }
    });
  });
});
