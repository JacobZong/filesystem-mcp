import assert from 'node:assert/strict';
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { basename, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  cleanupTestRoot,
  createElicitationClientPair,
  createTestRoot,
  firstTextBlock,
  trySymlink,
  writeTestFile,
} from './helpers.ts';

/**
 * Recursively delete `paths`, answering each prompt by the basename of the
 * directory it names and running `duringPrompt` once while the prompt is open.
 */
async function deleteAnsweringByName(
  root: string,
  args: { paths: string[]; ignoreIfNotExists?: boolean },
  answers: Readonly<Record<string, 'delete' | 'skip'>>,
  duringPrompt: () => Promise<void>,
) {
  let prompts = 0;
  const pair = await createElicitationClientPair([root], async (request) => {
    if (prompts++ === 0) await duringPrompt();
    const named = basename(/"([^"]+)"/.exec(request.params.message)?.[1] ?? '');
    const choice = answers[named];
    assert.ok(choice, `unexpected prompt: ${request.params.message}`);
    return { action: 'accept', content: { choice } };
  });
  try {
    const result = await pair.client.callTool({
      name: 'delete',
      arguments: { ...args, recursive: true },
    });
    const meta = result._meta as {
      results: {
        path: string;
        value?: { deleted: boolean };
        error?: { code: string; message: string };
      }[];
      summary: { total: number; succeeded: number; failed: number };
    };
    return { result, prompts, meta };
  } finally {
    await pair.close();
  }
}

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

  for (const replacement of ['file', 'symlink'] as const) {
    it(`delete refuses a confirmed directory replaced by a ${replacement} during confirmation`, async (t) => {
      const root = await createTestRoot();
      try {
        const d1 = join(root, 'd1');
        const d2 = join(root, 'd2');
        await writeTestFile(root, 'd1/x', '1');
        await writeTestFile(root, 'd2/x', '2');
        await writeTestFile(root, 'kept/x', 'link target');
        // Staged before the call, so a host that cannot create symlinks skips
        // here rather than inside the prompt.
        const staged = join(root, 'staged');
        if (replacement === 'file') {
          await writeFile(staged, 'replacement');
        } else if (
          !(await trySymlink(join(root, 'kept'), staged, () => t.skip('symlinks not permitted')))
        ) {
          return;
        }
        const { result, prompts, meta } = await deleteAnsweringByName(
          root,
          { paths: [d1, d2] },
          { d1: 'delete', d2: 'delete' },
          async () => {
            await rm(d2, { recursive: true });
            await rename(staged, d2);
          },
        );
        assert.strictEqual(prompts, 2);
        assert.notStrictEqual(result.isError, true, JSON.stringify(result));
        assert.deepStrictEqual(meta.summary, { total: 2, succeeded: 1, failed: 1 });
        assert.deepStrictEqual(meta.results[0], { path: d1, value: { deleted: true } });
        assert.strictEqual(meta.results[1]?.error?.code, 'INVALID_INPUT');
        assert.match(
          meta.results[1]?.error?.message ?? '',
          new RegExp(`item type changed from directory to ${replacement} during confirmation`),
        );
        await assert.rejects(access(d1), { code: 'ENOENT' });
        if (replacement === 'file') {
          assert.strictEqual(await readFile(d2, 'utf8'), 'replacement');
        } else {
          assert.strictEqual((await lstat(d2)).isSymbolicLink(), true);
          assert.strictEqual(await readFile(join(root, 'kept', 'x'), 'utf8'), 'link target');
        }
      } finally {
        await cleanupTestRoot(root);
      }
    });
  }

  for (const ignoreIfNotExists of [false, true]) {
    it(`delete keeps the other answers when a confirmed directory is removed during confirmation${ignoreIfNotExists ? ' (ignoreIfNotExists)' : ''}`, async () => {
      const root = await createTestRoot();
      try {
        const d1 = join(root, 'd1');
        const d2 = join(root, 'd2');
        await writeTestFile(root, 'd1/x', '1');
        await writeTestFile(root, 'd2/x', '2');
        const { result, prompts, meta } = await deleteAnsweringByName(
          root,
          { paths: [d1, d2], ignoreIfNotExists },
          { d1: 'delete', d2: 'delete' },
          () => rm(d2, { recursive: true }),
        );
        assert.strictEqual(prompts, 2);
        assert.notStrictEqual(result.isError, true, JSON.stringify(result));
        assert.deepStrictEqual(meta.results[0], { path: d1, value: { deleted: true } });
        if (ignoreIfNotExists) {
          assert.deepStrictEqual(meta.results[1], { path: d2, value: { deleted: true } });
          assert.deepStrictEqual(meta.summary, { total: 2, succeeded: 2, failed: 0 });
        } else {
          assert.strictEqual(meta.results[1]?.error?.code, 'NOT_FOUND');
          assert.deepStrictEqual(meta.summary, { total: 2, succeeded: 1, failed: 1 });
        }
        await assert.rejects(access(d1), { code: 'ENOENT' });
      } finally {
        await cleanupTestRoot(root);
      }
    });
  }

  it('delete reads each answer by its confirmed index when a directory before it vanishes', async () => {
    const root = await createTestRoot();
    try {
      const names = ['a', 'b', 'c', 'd'];
      for (const name of names) await writeTestFile(root, `${name}/x`, name);
      // b vanishes. An answer read by position in the surviving [a, c, d]
      // would give c b's 'delete' and d c's 'skip'.
      const { result, prompts, meta } = await deleteAnsweringByName(
        root,
        { paths: names.map((name) => join(root, name)) },
        { a: 'skip', b: 'delete', c: 'skip', d: 'delete' },
        () => rm(join(root, 'b'), { recursive: true }),
      );
      assert.strictEqual(prompts, 4);
      assert.notStrictEqual(result.isError, true, JSON.stringify(result));
      assert.deepStrictEqual(meta.results[0], { path: join(root, 'a'), value: { deleted: false } });
      assert.strictEqual(meta.results[1]?.error?.code, 'NOT_FOUND');
      assert.deepStrictEqual(meta.results[2], { path: join(root, 'c'), value: { deleted: false } });
      assert.deepStrictEqual(meta.results[3], { path: join(root, 'd'), value: { deleted: true } });
      assert.match(firstTextBlock(result).text ?? '', /a SKIPPED/);
      assert.strictEqual(await readFile(join(root, 'a', 'x'), 'utf8'), 'a');
      assert.strictEqual(await readFile(join(root, 'c', 'x'), 'utf8'), 'c');
      await assert.rejects(access(join(root, 'd')), { code: 'ENOENT' });
    } finally {
      await cleanupTestRoot(root);
    }
  });

  it('delete still rejects a retry whose pending set gains an unconfirmed directory', async () => {
    const root = await createTestRoot();
    try {
      const d1 = join(root, 'd1');
      const d2 = join(root, 'd2');
      await writeTestFile(root, 'd1/x', '1');
      await mkdir(d2);
      const { result, prompts } = await deleteAnsweringByName(
        root,
        { paths: [d1, d2] },
        { d1: 'delete' },
        () => writeFile(join(d2, 'x'), 'filled during the prompt'),
      );
      assert.strictEqual(prompts, 1);
      assert.strictEqual(result.isError, true, JSON.stringify(result));
      assert.match(
        firstTextBlock(result).text ?? '',
        /delete: confirmation does not match the requested paths/,
      );
      assert.strictEqual(await readFile(join(d1, 'x'), 'utf8'), '1');
      assert.strictEqual(await readFile(join(d2, 'x'), 'utf8'), 'filled during the prompt');
    } finally {
      await cleanupTestRoot(root);
    }
  });

  it('delete still rejects a retry whose confirmed directory matches no request entry', async (t) => {
    const root = await createTestRoot();
    try {
      await writeTestFile(root, 'real/d2/x', 'confirmed');
      await writeTestFile(root, 'other/d2', 'never confirmed');
      const link = join(root, 'link');
      if (!(await trySymlink(join(root, 'real'), link, () => t.skip('symlinks not permitted')))) {
        return;
      }
      // Repointing the parent leaves the confirmed directory in place while
      // the requested path now names a file nothing asked about.
      const { result, prompts } = await deleteAnsweringByName(
        root,
        { paths: [join(link, 'd2')] },
        { d2: 'delete' },
        async () => {
          await rm(link);
          await symlink(join(root, 'other'), link, 'junction');
        },
      );
      assert.strictEqual(prompts, 1);
      assert.strictEqual(result.isError, true, JSON.stringify(result));
      assert.match(
        firstTextBlock(result).text ?? '',
        /delete: confirmation does not match the requested paths/,
      );
      assert.strictEqual(await readFile(join(root, 'real', 'd2', 'x'), 'utf8'), 'confirmed');
      assert.strictEqual(await readFile(join(root, 'other', 'd2'), 'utf8'), 'never confirmed');
    } finally {
      await cleanupTestRoot(root);
    }
  });

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
