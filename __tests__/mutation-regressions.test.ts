import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  cleanupTestRoot,
  createElicitationClientPair,
  createTestRoot,
  trySymlink,
  writeTestFile,
} from './helpers.ts';

describe('Mutation regressions', () => {
  for (const emptyDuringPrompt of [false, true]) {
    for (const choice of ['skip', 'delete'] as const) {
      it(`delete honors ${choice} when the directory ${emptyDuringPrompt ? 'becomes empty' : 'stays nonempty'} during confirmation`, async () => {
        const root = await createTestRoot();
        let pair: Awaited<ReturnType<typeof createElicitationClientPair>> | undefined;
        try {
          const dir = join(root, 'target');
          const child = await writeTestFile(root, 'target/child.txt', 'keep');
          let prompts = 0;
          pair = await createElicitationClientPair([root], async () => {
            prompts++;
            if (emptyDuringPrompt) await rm(child);
            return { action: 'accept', content: { choice } };
          });
          const result = await pair.client.callTool({
            name: 'delete',
            arguments: { paths: [dir], recursive: true },
          });
          assert.strictEqual(prompts, 1);
          assert.notStrictEqual(result.isError, true, JSON.stringify(result));
          const meta = result._meta as {
            results: { value: { deleted: boolean } }[];
            summary: { total: number; succeeded: number; failed: number };
          };
          assert.deepStrictEqual(meta.summary, { total: 1, succeeded: 1, failed: 0 });
          assert.strictEqual(meta.results[0]?.value.deleted, choice === 'delete');
          if (choice === 'delete') {
            await assert.rejects(access(dir), { code: 'ENOENT' });
          } else {
            await access(dir);
            assert.deepStrictEqual(await readdir(dir), emptyDuringPrompt ? [] : ['child.txt']);
            if (!emptyDuringPrompt) assert.strictEqual(await readFile(child, 'utf8'), 'keep');
          }
        } finally {
          await pair?.close();
          await cleanupTestRoot(root);
        }
      });
    }
  }

  for (const copy of [false, true]) {
    for (const aliased of [false, true]) {
      it(`${copy ? 'copy' : 'move'} rejects overlapping ${aliased ? 'alias-resolved' : 'direct'} destination subtrees before mutation`, async (t) => {
        const root = await createTestRoot();
        let pair: Awaited<ReturnType<typeof createElicitationClientPair>> | undefined;
        try {
          const a = join(root, 'a');
          const b = join(root, 'b');
          const out = join(root, 'out');
          await writeTestFile(root, 'a/sub/x', 'A');
          await writeTestFile(root, 'b/x', 'B');
          await mkdir(out);
          const alias = join(root, 'alias');
          if (aliased && !(await trySymlink(out, alias, () => t.skip('symlinks not permitted')))) {
            return;
          }
          let prompts = 0;
          pair = await createElicitationClientPair([root], async () => {
            prompts++;
            return { action: 'accept', content: { choice: 'overwrite' } };
          });
          const result = await pair.client.callTool({
            name: 'move',
            arguments: {
              copy,
              overwrite: copy,
              moves: [
                { source: a, destination: out },
                { source: b, destination: join(aliased ? alias : out, 'sub') },
              ],
            },
          });
          assert.strictEqual(result.isError, true, JSON.stringify(result));
          const meta = result._meta as {
            moves: unknown[];
            failures: { error: { code: string; message: string } }[];
          };
          assert.strictEqual(meta.moves.length, 0);
          assert.strictEqual(meta.failures.length, 2);
          for (const failure of meta.failures) {
            assert.strictEqual(failure.error.code, 'INVALID_INPUT');
            assert.match(failure.error.message, /overlaps another entry/);
          }
          assert.strictEqual(prompts, 0, 'reject the overlap before asking to overwrite');
          assert.deepStrictEqual(await readdir(out), [], 'do not create destination children');
          assert.strictEqual(await readFile(join(a, 'sub', 'x'), 'utf8'), 'A');
          assert.strictEqual(await readFile(join(b, 'x'), 'utf8'), 'B');
        } finally {
          await pair?.close();
          await cleanupTestRoot(root);
        }
      });
    }
  }

  it('copies to non-overlapping sibling destinations both succeed', async () => {
    const root = await createTestRoot();
    let pair: Awaited<ReturnType<typeof createElicitationClientPair>> | undefined;
    try {
      await writeTestFile(root, 'a/x', 'A');
      await writeTestFile(root, 'b/x', 'B');
      pair = await createElicitationClientPair([root], async () => {
        assert.fail('new destinations need no confirmation');
      });
      const result = await pair.client.callTool({
        name: 'move',
        arguments: {
          copy: true,
          moves: [
            { source: join(root, 'a'), destination: join(root, 'out', 'one') },
            { source: join(root, 'b'), destination: join(root, 'out', 'two') },
          ],
        },
      });
      assert.notStrictEqual(result.isError, true, JSON.stringify(result));
      const meta = result._meta as { moves: unknown[]; failures?: unknown[] };
      assert.strictEqual(meta.moves.length, 2);
      assert.strictEqual(meta.failures, undefined);
      for (const [source, destination, content] of [
        ['a', 'one', 'A'],
        ['b', 'two', 'B'],
      ] as const) {
        assert.strictEqual(await readFile(join(root, source, 'x'), 'utf8'), content);
        assert.strictEqual(await readFile(join(root, 'out', destination, 'x'), 'utf8'), content);
      }
    } finally {
      await pair?.close();
      await cleanupTestRoot(root);
    }
  });
});
