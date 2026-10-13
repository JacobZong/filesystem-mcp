import assert from 'node:assert/strict';
import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { PathGuard } from '../src/core/path.ts';
import {
  cleanupTestRoot,
  createElicitationClientPair,
  createTestClientPair,
  createTestRoot,
  firstTextBlock,
  withEnv,
  writeTestFile,
} from './helpers.ts';

const exists = (p: string): Promise<boolean> =>
  access(p).then(
    () => true,
    () => false,
  );

describe('Data-loss guards', () => {
  let root: string;

  before(async () => {
    root = await createTestRoot();
  });

  after(async () => {
    if (root) await cleanupTestRoot(root);
  });

  it('GUARD-001: a destination that appears during confirmation makes the whole move fail closed', async () => {
    const srcA = await writeTestFile(root, 'g001/srcA.txt', 'A');
    const destA = await writeTestFile(root, 'g001/destA.txt', 'oldA');
    const srcB = await writeTestFile(root, 'g001/srcB.txt', 'B');
    const destB = join(root, 'g001', 'destB.txt');

    let calls = 0;
    const eh = await createElicitationClientPair([root], async () => {
      calls += 1;
      // The second destination appears while the human is looking at the prompt.
      await writeFile(destB, 'gap');
      return { action: 'accept' as const, content: { choice: 'overwrite' } };
    });
    try {
      const result = await eh.client.callTool({
        name: 'move',
        arguments: {
          moves: [
            { source: srcA, destination: destA },
            { source: srcB, destination: destB },
          ],
        },
      });
      assert.strictEqual(calls, 1, 'one confirmation round');
      assert.strictEqual(result.isError, true, 'fails closed');
      assert.match(
        firstTextBlock(result).text ?? '',
        /confirmation does not match the requested paths/,
      );
      assert.strictEqual(await readFile(destB, 'utf-8'), 'gap', 'destB is untouched');
      assert.strictEqual(await readFile(destA, 'utf-8'), 'oldA', 'destA is untouched');
      assert.strictEqual(await exists(srcA), true, 'srcA still exists');
      assert.strictEqual(await exists(srcB), true, 'srcB still exists');
    } finally {
      await eh.close();
    }
  });

  it('GUARD-002: two copy entries with one destination; only the first lands', async () => {
    const s1 = await writeTestFile(root, 'g002/s1.txt', 'one');
    const s2 = await writeTestFile(root, 'g002/s2.txt', 'two');
    const d = join(root, 'g002', 'd.txt');

    const h = await createTestClientPair([root]);
    try {
      const result = await h.client.callTool({
        name: 'move',
        arguments: {
          copy: true,
          moves: [
            { source: s1, destination: d },
            { source: s2, destination: d },
          ],
        },
      });
      assert.strictEqual(await readFile(d, 'utf-8'), 'one');
      assert.strictEqual(await exists(s1), true, 's1 still exists');
      assert.strictEqual(await exists(s2), true, 's2 still exists');
      assert.match(JSON.stringify(result._meta), /already targets destination/);
    } finally {
      await h.close();
    }
  });

  it('GUARD-002b: two move entries with one destination; only the first moves', async () => {
    const s1 = await writeTestFile(root, 'g002b/s1.txt', 'one');
    const s2 = await writeTestFile(root, 'g002b/s2.txt', 'two');
    const d = join(root, 'g002b', 'd.txt');

    const h = await createTestClientPair([root]);
    try {
      const result = await h.client.callTool({
        name: 'move',
        arguments: {
          moves: [
            { source: s1, destination: d },
            { source: s2, destination: d },
          ],
        },
      });
      assert.strictEqual(await readFile(d, 'utf-8'), 'one');
      assert.strictEqual(await exists(s1), false, 's1 moved away');
      assert.strictEqual(await readFile(s2, 'utf-8'), 'two', 's2 untouched');
      assert.match(JSON.stringify(result._meta), /already targets destination/);
    } finally {
      await h.close();
    }
  });

  it('GUARD-004: a delete whose target vanishes during confirmation reports NOT_FOUND without errno text', async () => {
    const dir = join(root, 'g004-dir');
    await writeTestFile(root, 'g004-dir/a.txt', 'x');

    let calls = 0;
    const eh = await createElicitationClientPair([root], async () => {
      calls += 1;
      await rm(dir, { recursive: true });
      return { action: 'accept' as const, content: { choice: 'delete' } };
    });
    try {
      const result = await eh.client.callTool({
        name: 'delete',
        arguments: { paths: [dir], recursive: true },
      });
      assert.strictEqual(calls, 1, 'one confirmation round');
      const meta = result._meta as {
        results?: { error?: { code?: string } }[];
        summary?: { failed?: number };
      };
      assert.strictEqual(meta.summary?.failed, 1);
      assert.strictEqual(meta.results?.[0]?.error?.code, 'NOT_FOUND');
      const wire = JSON.stringify(result);
      assert.match(wire, /Path not found/);
      assert.doesNotMatch(wire, /ENOENT|lstat/);
    } finally {
      await eh.close();
    }
  });

  it('GUARD-004b: the same vanished target with ignoreIfNotExists reports no failure', async () => {
    const dir = join(root, 'g004b-dir');
    await writeTestFile(root, 'g004b-dir/a.txt', 'x');

    let calls = 0;
    const eh = await createElicitationClientPair([root], async () => {
      calls += 1;
      await rm(dir, { recursive: true });
      return { action: 'accept' as const, content: { choice: 'delete' } };
    });
    try {
      const result = await eh.client.callTool({
        name: 'delete',
        arguments: { paths: [dir], recursive: true, ignoreIfNotExists: true },
      });
      assert.strictEqual(calls, 1, 'one confirmation round');
      const meta = result._meta as { summary?: { failed?: number } };
      assert.strictEqual(meta.summary?.failed, 0);
    } finally {
      await eh.close();
    }
  });

  it('GUARD-005: a grant whose recompute throws leaves the allowed set unchanged', async () => {
    await withEnv({ FS_ROOT_BOUNDARY: undefined }, async () => {
      const guard = new PathGuard({ cliAllowedDirs: [root] });
      await guard.recomputeAllowedDirectories();
      const before = guard.getAllowedDirectories();
      const outside = await createTestRoot();
      try {
        const original = guard.recomputeAllowedDirectories.bind(guard);
        guard.recomputeAllowedDirectories = () => Promise.reject(new Error('recompute failed'));
        await assert.rejects(guard.applyGrant(outside), /recompute failed/);
        guard.recomputeAllowedDirectories = original;
        await guard.recomputeAllowedDirectories();
        assert.deepStrictEqual(
          guard.getAllowedDirectories(),
          before,
          'a rolled-back grant must not reappear',
        );
      } finally {
        await cleanupTestRoot(outside);
      }
    });
  });
});
