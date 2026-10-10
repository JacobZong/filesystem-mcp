import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';

import {
  ensureIndex,
  indexStatus,
  resetIndexForTests,
  searchIndex,
} from '../src/core/file-index.ts';

describe('filename index persistence', () => {
  let root: string;
  let otherRoot: string;
  let indexDir: string;
  const previousDir = process.env['FS_INDEX_DIR'];

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'idx-root-'));
    otherRoot = await mkdtemp(join(tmpdir(), 'idx-other-'));
    indexDir = await mkdtemp(join(tmpdir(), 'idx-store-'));
    await mkdir(join(root, 'books'));
    await writeFile(join(root, 'books', '大逃港.azw3'), 'x');
    process.env['FS_INDEX_DIR'] = indexDir;
  });

  beforeEach(() => {
    resetIndexForTests();
  });

  after(async () => {
    resetIndexForTests();
    if (previousDir === undefined) delete process.env['FS_INDEX_DIR'];
    else process.env['FS_INDEX_DIR'] = previousDir;
    await Promise.all(
      [root, otherRoot, indexDir].map((d) => rm(d, { recursive: true, force: true })),
    );
  });

  it('saves the index and loads it after a restart without rescanning', async () => {
    await ensureIndex([root]);
    assert.equal(indexStatus().loadedFromDisk, false);
    assert.equal(searchIndex(['大逃港'], new Set(), 10).length, 1);

    // A file added after the build is not seen by a load from disk: proof that no rescan ran.
    await writeFile(join(root, 'books', '大逃港 续.epub'), 'x');
    resetIndexForTests(); // simulates a container restart
    await ensureIndex([root]);
    const status = indexStatus();
    assert.equal(status.loadedFromDisk, true);
    assert.equal(status.building, false);
    assert.equal(searchIndex(['大逃港'], new Set(), 10).length, 1);
  });

  it('ignores a saved index built for other roots', async () => {
    await ensureIndex([otherRoot]);
    const status = indexStatus();
    assert.equal(status.loadedFromDisk, false);
    assert.equal(status.files, 0);
  });
});
