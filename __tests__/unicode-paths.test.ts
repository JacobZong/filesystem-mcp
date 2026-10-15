import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  cleanupTestRoot,
  createTestClientPair,
  createTestRoot,
  firstTextBlock,
} from './helpers.ts';

// Issue #101. Names are built from escapes so the source file's own
// normalization cannot change what lands on disk.
const NFC_CAFE = 'caf\u00e9';
const NFD_CAFE = 'cafe\u0301';
const NBSP_NAME = 'a\u00a0b.txt';
const NNBSP_NAME = 'a\u202fb.txt';

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

  describe('through the tools', () => {
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
