import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  cleanupTestRoot,
  createTestClientPair,
  createTestRoot,
  type TestClientContext,
} from './helpers.ts';

interface StatValue {
  type?: string;
  size?: number;
  entryCount?: number;
}

// A folder has no size, so stat counts its direct children instead. Secret
// files are left out of the count, the same way listings hide them.
describe('stat entryCount for a directory', () => {
  let root: string;
  let harness: TestClientContext;
  let values: (StatValue | undefined)[] = [];

  before(async () => {
    root = await createTestRoot();
    const empty = join(root, 'empty');
    const full = join(root, 'full');
    await mkdir(empty);
    await mkdir(join(full, 'sub'), { recursive: true });
    await writeFile(join(full, 'a.txt'), 'hello');
    await writeFile(join(full, '.hidden'), 'hidden');
    await writeFile(join(full, '.env'), 'SECRET=1');
    harness = await createTestClientPair([root]);

    const result = await harness.client.callTool({
      name: 'stat',
      arguments: { paths: [empty, full, join(full, 'a.txt')] },
    });
    assert.notStrictEqual(result.isError, true);
    const sc = result.structuredContent as { results: { value?: StatValue }[] };
    values = sc.results.map((row) => row.value);
  });

  after(async () => {
    await harness.close();
    await cleanupTestRoot(root);
  });

  it('reports entryCount 0 for an empty folder, with no size', () => {
    const value = values[0];
    assert.ok(value, 'stat must return a value');
    assert.strictEqual(value.type, 'directory');
    assert.strictEqual(value.entryCount, 0);
    assert.ok(!('size' in value), 'a folder must not report a size');
  });

  it('counts hidden entries and folders but not secret files', () => {
    const value = values[1];
    assert.ok(value, 'stat must return a value');
    assert.strictEqual(value.type, 'directory');
    // a.txt, .hidden and sub count; .env is a blocked secret file and does not.
    assert.strictEqual(value.entryCount, 3);
    assert.ok(!('size' in value), 'a folder must not report a size');
  });

  it('reports size and no entryCount for a file', () => {
    const value = values[2];
    assert.ok(value, 'stat must return a value');
    assert.strictEqual(value.type, 'file');
    assert.strictEqual(typeof value.size, 'number');
    assert.ok(!('entryCount' in value), 'a file must not report an entryCount');
  });
});
