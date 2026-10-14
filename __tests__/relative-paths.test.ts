import assert from 'node:assert/strict';
import { access, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ErrorCode } from '../src/core/errors.ts';
import {
  cleanupTestRoot,
  createTestClientPair,
  createTestRoot,
  firstTextBlock,
  fsErrorMatcher,
  makeGuard,
  type TestClientContext,
  writeTestFile,
} from './helpers.ts';

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

// A desktop host starts the server outside the project and an HTTP client
// never shares its working directory, so a relative path the server itself
// printed (search_text, find_files) resolves against the roots once the
// working directory puts it outside every one.
describe('relative paths', () => {
  let base: string;
  let root: string;
  let second: string;
  let elsewhere: string;
  let previousCwd: string;

  before(async () => {
    base = await createTestRoot();
    root = join(base, 'root');
    second = join(base, 'second');
    elsewhere = join(base, 'elsewhere');
    await mkdir(elsewhere, { recursive: true });
    await writeTestFile(root, 'src/a.ts', 'export const NEEDLE = 1;\n');
    await writeTestFile(root, 'only-first.txt', 'first');
    await writeTestFile(root, 'both.txt', 'first');
    await writeTestFile(second, 'both.txt', 'second');
    await writeTestFile(second, 'only-second.txt', 'second');
    await writeTestFile(second, '.env', 'SECRET=1');
    previousCwd = process.cwd();
    process.chdir(elsewhere);
  });

  after(async () => {
    process.chdir(previousCwd);
    await cleanupTestRoot(base);
  });

  describe('PathGuard.resolveRelativePaths', () => {
    it('resolves against the one root when the working directory is outside it', async () => {
      const guard = await makeGuard([root]);
      const resolved = await guard.resolveRelativePaths(['src/a.ts', 'missing/new.txt']);
      assert.strictEqual(resolved.get('src/a.ts'), join(root, 'src/a.ts'));
      assert.strictEqual(resolved.get('missing/new.txt'), join(root, 'missing/new.txt'));
    });

    it('leaves absolute and home-relative paths alone', async () => {
      const guard = await makeGuard([root]);
      const resolved = await guard.resolveRelativePaths([join(root, 'src/a.ts'), '~/notes.md']);
      assert.strictEqual(resolved.size, 0, JSON.stringify([...resolved]));
    });

    it('keeps resolving against a working directory inside a root', async () => {
      const guard = await makeGuard([root]);
      process.chdir(join(root, 'src'));
      try {
        assert.strictEqual((await guard.resolveRelativePaths(['a.ts'])).size, 0);
      } finally {
        process.chdir(elsewhere);
      }
    });

    it('picks the one root the path exists under when there are several', async () => {
      const guard = await makeGuard([root, second]);
      const resolved = await guard.resolveRelativePaths(['only-first.txt', 'only-second.txt']);
      assert.strictEqual(resolved.get('only-first.txt'), join(root, 'only-first.txt'));
      assert.strictEqual(resolved.get('only-second.txt'), join(second, 'only-second.txt'));
    });

    it('refuses a path that exists under more than one root', async () => {
      const guard = await makeGuard([root, second]);
      await assert.rejects(
        guard.resolveRelativePaths(['both.txt']),
        fsErrorMatcher(ErrorCode.INVALID_INPUT, 'exists under more than one root'),
      );
    });

    it('refuses a path that exists under none of several roots', async () => {
      const guard = await makeGuard([root, second]);
      await assert.rejects(
        guard.resolveRelativePaths(['nowhere.txt']),
        fsErrorMatcher(ErrorCode.INVALID_INPUT, 'exists under none of the 2 roots'),
      );
    });

    it('never probes a blocked name, so its existence stays hidden', async () => {
      // Only the second root holds .env; probing would pick it and say so.
      const guard = await makeGuard([root, second]);
      const resolved = await guard.resolveRelativePaths(['.env']);
      assert.strictEqual(resolved.get('.env'), join(root, '.env'));
    });

    it('changes nothing when no root is configured', async () => {
      const guard = await makeGuard([]);
      assert.strictEqual((await guard.resolveRelativePaths(['src/a.ts'])).size, 0);
    });
  });

  describe('through the tools', () => {
    let harness: TestClientContext;

    before(async () => {
      harness = await createTestClientPair([root]);
    });

    after(async () => {
      await harness.close();
    });

    it('reads a path that search_text printed', async () => {
      const search = await harness.client.callTool({
        name: 'search_text',
        arguments: { searchPattern: 'NEEDLE' },
      });
      const printed = /^(\S+):1:/mu.exec(firstTextBlock(search).text ?? '')?.[1];
      assert.strictEqual(printed, 'src/a.ts');
      const read = await harness.client.callTool({ name: 'read', arguments: { path: printed } });
      assert.notStrictEqual(read.isError, true, firstTextBlock(read).text);
      assert.match(firstTextBlock(read).text ?? '', /export const NEEDLE = 1;/u);
    });

    it('creates a relative path under the root, not the working directory', async () => {
      const result = await harness.client.callTool({
        name: 'create',
        arguments: { files: [{ path: 'out/new.txt', content: 'made' }] },
      });
      assert.notStrictEqual(result.isError, true, firstTextBlock(result).text);
      assert.strictEqual(await readFile(join(root, 'out/new.txt'), 'utf-8'), 'made');
      assert.strictEqual(await exists(join(elsewhere, 'out/new.txt')), false);
    });

    it('refuses a batch whose relative and absolute entries name one file', async () => {
      const result = await harness.client.callTool({
        name: 'create',
        arguments: {
          files: [
            { path: 'dup.txt', content: 'one' },
            { path: join(root, 'dup.txt'), content: 'two' },
          ],
        },
      });
      assert.strictEqual(result.isError, true);
      assert.match(firstTextBlock(result).text ?? '', /duplicate of files\[0\]\.path/u);
      assert.strictEqual(await exists(join(root, 'dup.txt')), false);
    });

    it('still blocks a relative secret-file path', async () => {
      await writeTestFile(root, '.env', 'SECRET=1');
      const result = await harness.client.callTool({ name: 'read', arguments: { path: '.env' } });
      assert.strictEqual(result.isError, true);
      assert.match(firstTextBlock(result).text ?? '', /Sensitive file blocked/u);
    });
  });

  it('names the roots when a relative path is ambiguous', async () => {
    const harness = await createTestClientPair([root, second]);
    try {
      const result = await harness.client.callTool({
        name: 'read',
        arguments: { path: 'both.txt' },
      });
      assert.strictEqual(result.isError, true);
      const text = firstTextBlock(result).text ?? '';
      assert.match(text, /exists under more than one root/u);
      assert.ok(text.includes(join(root, 'both.txt')) && text.includes(join(second, 'both.txt')));
    } finally {
      await harness.close();
    }
  });
});
