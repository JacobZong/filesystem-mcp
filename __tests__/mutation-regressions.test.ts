import assert from 'node:assert/strict';
import { access, mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { normalizePath } from '../src/core/path-utils.ts';
import {
  cleanupTestRoot,
  createElicitationClientPair,
  createTestRoot,
  trySymlink,
  withBoundary,
  writeTestFile,
} from './helpers.ts';

describe('Mutation regressions', () => {
  it('delete binds its own identity after an access-grant round', async () => {
    const root = await createTestRoot();
    try {
      await withBoundary(root, async () => {
        const allowed = join(root, 'allowed');
        const dir = join(allowed, 'target');
        await writeTestFile(root, 'allowed/target/child.txt', 'original');
        const outside = await writeTestFile(root, 'outside/file.txt', 'outside');
        let prompts = 0;
        const pair = await createElicitationClientPair([allowed], async () => {
          prompts++;
          return prompts === 1
            ? { action: 'accept', content: { confirm: true } }
            : { action: 'accept', content: { choice: 'delete' } };
        });
        try {
          const result = await pair.client.callTool({
            name: 'delete',
            arguments: { paths: [dir, outside], recursive: true },
          });
          assert.strictEqual(prompts, 2);
          assert.notStrictEqual(result.isError, true, JSON.stringify(result));
          await assert.rejects(access(dir), { code: 'ENOENT' });
          await assert.rejects(access(outside), { code: 'ENOENT' });
        } finally {
          await pair.close();
        }
      });
    } finally {
      await cleanupTestRoot(root);
    }
  });

  for (const replacement of ['empty directory', 'nonempty directory', 'file']) {
    for (const choice of ['skip', 'delete'] as const) {
      for (const batch of [false, true]) {
        it(`delete ${choice} preserves a replacement ${replacement}${batch ? ' alongside an unrelated file' : ''}`, async () => {
          const root = await createTestRoot();
          let pair: Awaited<ReturnType<typeof createElicitationClientPair>> | undefined;
          try {
            const dir = join(root, 'target');
            const original = join(root, 'original');
            await writeTestFile(root, 'target/child.txt', 'original');
            const unrelated = await writeTestFile(root, 'unrelated.txt', 'unrelated');
            let prompts = 0;
            pair = await createElicitationClientPair([root], async () => {
              prompts++;
              await rename(dir, original);
              if (replacement === 'file') {
                await writeTestFile(root, 'target', 'replacement');
              } else {
                await mkdir(dir);
                if (replacement === 'nonempty directory') {
                  await writeTestFile(root, 'target/child.txt', 'replacement');
                }
              }
              return { action: 'accept', content: { choice } };
            });
            const result = await pair.client.callTool({
              name: 'delete',
              arguments: { paths: batch ? [unrelated, dir] : [dir], recursive: true },
            });
            assert.strictEqual(prompts, 1);
            const meta = result._meta as {
              results: {
                path: string;
                value?: { deleted: boolean };
                error?: { code: string; message: string };
              }[];
              summary: { total: number; succeeded: number; failed: number };
            };
            const failed = choice === 'delete' ? 1 : 0;
            assert.deepStrictEqual(meta.summary, {
              total: batch ? 2 : 1,
              succeeded: (batch ? 2 : 1) - failed,
              failed,
            });
            const target = meta.results.find((entry) => entry.path === normalizePath(dir));
            assert.ok(target);
            if (choice === 'delete') {
              assert.strictEqual(target.error?.code, 'INVALID_INPUT');
              assert.match(target.error.message, /identity/);
              if (!batch) assert.strictEqual(result.isError, true);
            } else {
              assert.deepStrictEqual(target.value, { deleted: false });
              assert.notStrictEqual(result.isError, true);
            }
            assert.strictEqual(await readFile(join(original, 'child.txt'), 'utf8'), 'original');
            if (replacement === 'file') {
              assert.strictEqual(await readFile(dir, 'utf8'), 'replacement');
            } else if (replacement === 'nonempty directory') {
              assert.strictEqual(await readFile(join(dir, 'child.txt'), 'utf8'), 'replacement');
            } else {
              assert.deepStrictEqual(await readdir(dir), []);
            }
            if (batch) await assert.rejects(access(unrelated), { code: 'ENOENT' });
            else assert.strictEqual(await readFile(unrelated, 'utf8'), 'unrelated');
          } finally {
            await pair?.close();
            await cleanupTestRoot(root);
          }
        });
      }
    }
  }

  for (const change of ['remove pending directory', 'add pending directory']) {
    it(`delete fails closed before unrelated mutations when confirmation paths change: ${change}`, async () => {
      const root = await createTestRoot();
      let pair: Awaited<ReturnType<typeof createElicitationClientPair>> | undefined;
      try {
        const dir = join(root, 'target');
        const other = join(root, 'other');
        await writeTestFile(root, 'target/child.txt', 'original');
        await mkdir(other);
        const unrelated = await writeTestFile(root, 'unrelated.txt', 'unrelated');
        pair = await createElicitationClientPair([root], async () => {
          if (change === 'remove pending directory') await rename(dir, join(root, 'original'));
          else await writeTestFile(root, 'other/child.txt', 'new pending');
          return { action: 'accept', content: { choice: 'delete' } };
        });
        const result = await pair.client.callTool({
          name: 'delete',
          arguments: {
            paths: [dir, other, unrelated],
            recursive: true,
            ignoreIfNotExists: true,
          },
        });
        assert.strictEqual(result.isError, true, JSON.stringify(result));
        assert.match(JSON.stringify(result), /confirmation does not match/);
        assert.strictEqual(await readFile(unrelated, 'utf8'), 'unrelated');
        await access(other);
        const original = change === 'remove pending directory' ? join(root, 'original') : dir;
        assert.strictEqual(await readFile(join(original, 'child.txt'), 'utf8'), 'original');
      } finally {
        await pair?.close();
        await cleanupTestRoot(root);
      }
    });
  }

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
