import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  cleanupTestRoot,
  createTestClientPair,
  createTestRoot,
  firstTextBlock,
  type TestClientContext,
} from './helpers.ts';

describe('create with directories', () => {
  let root: string;
  let harness: TestClientContext;

  before(async () => {
    root = await createTestRoot();
    harness = await createTestClientPair([root]);
  });

  after(async () => {
    await harness.close();
    await cleanupTestRoot(root);
  });

  it('makes a nested empty directory and lists it in directories', async () => {
    const dir = join(root, 'a', 'b', 'c');
    const result = await harness.client.callTool({
      name: 'create',
      arguments: { directories: [dir] },
    });
    assert.notStrictEqual(result.isError, true, firstTextBlock(result).text);
    assert.ok((await stat(dir)).isDirectory());
    const structured = result.structuredContent as { directories?: string[] };
    assert.ok(structured.directories?.includes(dir), 'directories lists the made folder');
  });

  it('is idempotent: an existing directory is left as it is', async () => {
    const dir = join(root, 'a', 'b', 'c');
    const result = await harness.client.callTool({
      name: 'create',
      arguments: { directories: [dir] },
    });
    assert.notStrictEqual(result.isError, true, firstTextBlock(result).text);
    assert.ok((await stat(dir)).isDirectory());
  });

  it('makes a directory and a file inside it in one call', async () => {
    const dir = join(root, 'd');
    const file = join(dir, 'x.txt');
    const result = await harness.client.callTool({
      name: 'create',
      arguments: { directories: [dir], files: [{ path: file, content: 'hi' }] },
    });
    assert.notStrictEqual(result.isError, true, firstTextBlock(result).text);
    assert.ok((await stat(dir)).isDirectory());
    assert.strictEqual(await readFile(file, 'utf-8'), 'hi');
  });

  it('refuses a call that carries neither files nor directories', async () => {
    const result = await harness.client.callTool({ name: 'create', arguments: {} });
    assert.strictEqual(result.isError, true);
    assert.match(firstTextBlock(result).text ?? '', /Provide files, directories, or both/u);
  });

  it('reports a directory path that is an existing file as a failure', async () => {
    const file = join(root, 'plain.txt');
    await writeFile(file, 'not a folder');
    const result = await harness.client.callTool({
      name: 'create',
      arguments: { directories: [file] },
    });
    assert.strictEqual(result.isError, true);
    const structured = result.structuredContent as { failures?: { path: string }[] };
    assert.deepStrictEqual(
      (structured.failures ?? []).map((failure) => failure.path),
      [file],
    );
  });

  it('counts progress across the directory and file batches', async (t) => {
    // Each Date.now() read advances one rate-limit window, so every tick is sent
    // and only the progress counter decides which values reach the client.
    let now = 0;
    t.mock.method(Date, 'now', () => (now += 50));
    const dirs = [1, 2, 3].map((n) => join(root, 'progress', `d${String(n)}`));
    const files = [1, 2].map((n) => ({
      path: join(root, 'progress', `f${String(n)}.txt`),
      content: `file ${String(n)}`,
    }));
    const frames: { progress: number; total?: number | undefined }[] = [];
    const result = await harness.client.callTool(
      { name: 'create', arguments: { directories: dirs, files } },
      {
        onprogress: (p) => {
          frames.push(p);
        },
      },
    );
    assert.notStrictEqual(result.isError, true, firstTextBlock(result).text);

    let previous = -1;
    for (const frame of frames) {
      assert.ok(
        frame.progress > previous,
        `progress must strictly increase: ${JSON.stringify(frames)}`,
      );
      previous = frame.progress;
    }
    // Frames are a start (0), one tick per entry, then the completion, which
    // lands one past the last tick.
    const ticks = frames.slice(1, -1);
    assert.deepStrictEqual(
      ticks.map((frame) => frame.progress),
      [1, 2, 3, 4, 5],
    );
    assert.ok(
      ticks.every((frame) => frame.total === 5),
      JSON.stringify(ticks),
    );
  });
});
