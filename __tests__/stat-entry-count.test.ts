import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { GuardedFileSystem } from '../src/core/fs.ts';
import {
  cleanupTestRoot,
  createTestClientPair,
  createTestRoot,
  firstTextBlock,
  type TestClientContext,
  trySymlink,
  withEnv,
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
  let outside: string;
  let harness: TestClientContext;
  let values: (StatValue | undefined)[] = [];

  before(async () => {
    root = await createTestRoot();
    outside = await createTestRoot();
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
    await cleanupTestRoot(outside);
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

  it('does not count a symlink to a secret file or outside the roots', async (t) => {
    const linked = join(root, 'linked');
    await mkdir(linked);
    await writeFile(join(linked, 'a.txt'), 'hello');
    await writeFile(join(linked, '.env'), 'SECRET=1');
    const skip = () => t.skip('symlink not permitted');
    if (!(await trySymlink(join(linked, '.env'), join(linked, 'env-link'), skip, 'file'))) return;
    if (!(await trySymlink(outside, join(linked, 'out-link'), skip))) return;

    const result = await harness.client.callTool({ name: 'stat', arguments: { path: linked } });
    assert.notStrictEqual(result.isError, true);
    const sc = result.structuredContent as { results: { value?: StatValue }[] };
    // Only a.txt is listed; .env, env-link and out-link are hidden, so none count.
    assert.strictEqual(sc.results[0]?.value?.entryCount, 1);
  });

  it('reports TIMEOUT when the deadline fires mid-count, and no entryCount when the count fails', async () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restored in the finally below
    const original = GuardedFileSystem.prototype.countEntries;
    const full = join(root, 'full');
    try {
      // The deadline fires at 1000 ms; the count wakes at 1500 ms and sees the abort.
      GuardedFileSystem.prototype.countEntries = async function (_dirPath, options) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        options?.signal?.throwIfAborted();
        return 0;
      };
      const result = await withEnv({ FS_TOOL_TIMEOUT_MS: '1000' }, () =>
        harness.client.callTool({ name: 'stat', arguments: { path: full } }),
      );
      assert.strictEqual(result.isError, true);
      const sc = result.structuredContent as { results: { error?: { code: string } }[] };
      assert.strictEqual(sc.results[0]?.error?.code, 'TIMEOUT');

      // Control: an ordinary count failure still degrades to a stat without entryCount.
      GuardedFileSystem.prototype.countEntries = async function () {
        throw new Error('boom');
      };
      const control = await harness.client.callTool({ name: 'stat', arguments: { path: full } });
      assert.notStrictEqual(control.isError, true);
      const csc = control.structuredContent as { results: { value?: StatValue }[] };
      const value = csc.results[0]?.value;
      assert.ok(value, 'stat must return a value');
      assert.ok(!('entryCount' in value), 'a failed count must not report an entryCount');
    } finally {
      GuardedFileSystem.prototype.countEntries = original;
    }
  });

  it('does not count a secret under a directory alias when the deny rule names its real path', async (t) => {
    const real = join(root, 'real', 'sub');
    await mkdir(real, { recursive: true });
    await writeFile(join(real, 'secret.txt'), 'shh');
    await writeFile(join(real, 'visible.txt'), 'hi');
    const skip = () => t.skip('symlink not permitted');
    if (!(await trySymlink(join(root, 'real'), join(root, 'alias'), skip))) return;
    // A symlink whose own real location is denied: list walks the real
    // directory, so it hides the link even though its target is visible.
    if (!(await trySymlink(join(real, 'visible.txt'), join(real, 'link.txt'), skip))) return;

    // A separate server, so the deny rule applies here and not to the harness above.
    const denied = await withEnv({ FS_DENYLIST: 'real/sub/secret.txt,real/sub/link.txt' }, () =>
      createTestClientPair([root]),
    );
    try {
      const alias = join(root, 'alias', 'sub');
      const list = await denied.client.callTool({ name: 'list', arguments: { path: alias } });
      const listed = firstTextBlock(list).text ?? '';
      assert.match(listed, /visible\.txt/u);
      assert.doesNotMatch(listed, /secret\.txt/u);
      assert.doesNotMatch(listed, /link\.txt/u);

      const viaAlias = await denied.client.callTool({ name: 'stat', arguments: { path: alias } });
      const viaReal = await denied.client.callTool({ name: 'stat', arguments: { path: real } });
      const count = (result: typeof viaAlias) =>
        (result.structuredContent as { results: { value?: StatValue }[] }).results[0]?.value
          ?.entryCount;
      // secret.txt and link.txt are hidden under both spellings, so only visible.txt counts.
      assert.strictEqual(count(viaAlias), 1);
      assert.strictEqual(count(viaReal), 1);
    } finally {
      await denied.close();
    }
  });
});
