import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';

import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ErrorCode } from '../src/core/errors.ts';
import { buildFileResourceUri } from '../src/core/file-uri.ts';
import { MAX_OUTBOUND_RESULT_BYTES, MIB } from '../src/core/util.ts';
import {
  cleanupTestRoot,
  createStdioClient,
  createTestHttpHarness,
  createTestRoot,
  firstTextBlock,
  withBoundary,
} from './helpers.ts';

describe('read-only outbound result limits', { timeout: 60_000 }, () => {
  let root: string;
  let harness: Awaited<ReturnType<typeof createStdioClient>>;
  let longLines: string;
  let escapedLine: string;
  let smallEscapedLine: string;
  let recoveryFile: string;
  let diffA: string;
  let diffB: string;
  let resourceFile: string;
  let binaryFile: string;
  let cachedFile: string;

  before(async () => {
    root = await createTestRoot();
    longLines = join(root, 'long-lines.txt');
    escapedLine = join(root, 'escaped-line.txt');
    smallEscapedLine = join(root, 'small-escaped-line.txt');
    recoveryFile = join(root, 'recovery.txt');
    diffA = join(root, 'diff-a.txt');
    diffB = join(root, 'diff-b.txt');
    resourceFile = join(root, 'resource.txt');
    binaryFile = join(root, 'resource.bin');
    cachedFile = join(root, 'cached.txt');
    await Promise.all([
      writeFile(longLines, `NEEDLE${'x'.repeat(3 * MIB - 6)}\n`.repeat(2)),
      writeFile(escapedLine, `NEEDLE${'"'.repeat(3 * MIB - 6)}\n`),
      writeFile(smallEscapedLine, `NEEDLE${'"'.repeat(MIB - 6)}\n`),
      writeFile(recoveryFile, 'connection survived\n'),
      writeFile(diffA, `${'a'.repeat(6 * MIB)}\n`),
      writeFile(diffB, `${'b'.repeat(6 * MIB)}\n`),
      writeFile(resourceFile, 'line\n'.repeat(Math.floor((9.9 * MIB) / 5))),
      writeFile(binaryFile, Buffer.alloc(8 * MIB)),
      writeFile(cachedFile, `NEEDLE${'"'.repeat(MIB)}\n`.repeat(3)),
    ]);
    harness = await createStdioClient(root, { FS_ROOT_BOUNDARY: root });
  });

  after(async () => {
    try {
      await harness?.close();
    } finally {
      if (root) await cleanupTestRoot(root);
    }
  });

  async function assertRecovery(): Promise<void> {
    const read = await harness.client.callTool(
      { name: 'read', arguments: { path: recoveryFile } },
      { timeout: 5000 },
    );
    assert.notStrictEqual(read.isError, true);
    assert.strictEqual(firstTextBlock(read).text, 'connection survived\n');
  }

  async function assertResourceTooLarge(uri: string): Promise<void> {
    await assert.rejects(
      harness.client.readResource({ uri }, { timeout: 5000 }),
      (error: unknown) => {
        assert.ok(ProtocolError.isInstance(error));
        assert.strictEqual(error.code, ProtocolErrorCode.InvalidParams);
        const data = error.data as { code?: string; suggestion?: string };
        assert.strictEqual(data.code, ErrorCode.TOO_LARGE);
        assert.match(data.suggestion ?? '', /HTTP/);
        assert.match(error.message, /stdio/);
        assert.ok(error.message.length < 1024, 'the error must remain compact');
        return true;
      },
    );
    await assertRecovery();
  }

  it('refuses duplicated search output before stdio closes, and smaller pages work', async () => {
    const result = await harness.client.callTool(
      {
        name: 'search_text',
        arguments: { path: longLines, searchPattern: 'NEEDLE', maxResults: 2 },
      },
      { timeout: 5000 },
    );
    assert.strictEqual(result.isError, true);
    assert.match(firstTextBlock(result).text ?? '', /TOO_LARGE.*stdio.*HTTP/);
    await assertRecovery();

    const page = await harness.client.callTool(
      {
        name: 'search_text',
        arguments: { path: longLines, searchPattern: 'NEEDLE', maxResults: 1 },
      },
      { timeout: 5000 },
    );
    assert.notStrictEqual(page.isError, true);
    assert.ok(Buffer.byteLength(JSON.stringify(page), 'utf8') < MAX_OUTBOUND_RESULT_BYTES);
    const metadata = page._meta as { matches: unknown[]; nextCursor?: string };
    assert.strictEqual(metadata.matches.length, 1);
    assert.ok(metadata.nextCursor);
  });

  it('counts JSON escaping even for one match and permits smaller escaped content', async () => {
    const result = await harness.client.callTool(
      {
        name: 'search_text',
        arguments: { path: escapedLine, searchPattern: 'NEEDLE', maxResults: 1 },
      },
      { timeout: 5000 },
    );
    assert.strictEqual(result.isError, true);
    assert.match(firstTextBlock(result).text ?? '', /TOO_LARGE/);
    await assertRecovery();

    const small = await harness.client.callTool(
      {
        name: 'search_text',
        arguments: { path: smallEscapedLine, searchPattern: 'NEEDLE', maxResults: 1 },
      },
      { timeout: 5000 },
    );
    assert.notStrictEqual(small.isError, true);
    const metadata = small._meta as { matches: { content: string }[] };
    assert.strictEqual(metadata.matches[0]?.content, `NEEDLE${'"'.repeat(MIB - 6)}`);
  });

  it('refuses oversized diffs without losing the connection', async () => {
    const result = await harness.client.callTool(
      { name: 'diff', arguments: { a: diffA, b: diffB } },
      { timeout: 5000 },
    );
    assert.strictEqual(result.isError, true);
    assert.match(firstTextBlock(result).text ?? '', /TOO_LARGE.*stdio.*HTTP/);
    await assertRecovery();
  });

  it('refuses file resources expanded by JSON escaping or base64, and small reads still work', async () => {
    await assertResourceTooLarge(buildFileResourceUri(resourceFile));
    await assertResourceTooLarge(buildFileResourceUri(binaryFile));
    const result = await harness.client.readResource(
      { uri: buildFileResourceUri(recoveryFile) },
      { timeout: 5000 },
    );
    const content = result.contents[0];
    assert.ok(content && 'text' in content);
    assert.strictEqual(content.text, 'connection survived\n');
  });

  it('an advertised cached resource cannot overflow stdio through another JSON encoding', async () => {
    const page = await harness.client.callTool(
      {
        name: 'search_text',
        arguments: { path: cachedFile, searchPattern: 'NEEDLE', maxResults: 1 },
      },
      { timeout: 5000 },
    );
    assert.notStrictEqual(page.isError, true);
    const link = page.content.find((block) => block.type === 'resource_link');
    assert.ok(link);
    assert.ok(link.size !== undefined && link.size < MAX_OUTBOUND_RESULT_BYTES);
    await assertResourceTooLarge(link.uri);

    const metadata = page._meta as { nextCursor?: string };
    assert.ok(metadata.nextCursor);
    const next = await harness.client.callTool(
      {
        name: 'search_text',
        arguments: {
          path: cachedFile,
          searchPattern: 'NEEDLE',
          maxResults: 1,
          cursor: metadata.nextCursor,
        },
      },
      { timeout: 5000 },
    );
    assert.notStrictEqual(next.isError, true, 'the smaller search pages remain available');
  });

  it('preserves oversized tool and resource results over HTTP', async () => {
    await withBoundary(root, async () => {
      const http = await createTestHttpHarness([root]);
      try {
        const result = await http.client.callTool(
          {
            name: 'search_text',
            arguments: { path: longLines, searchPattern: 'NEEDLE', maxResults: 2 },
          },
          { timeout: 5000 },
        );
        assert.notStrictEqual(result.isError, true);
        assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') > 10 * MIB);
        const metadata = result._meta as { matches: { content: string }[] };
        assert.strictEqual(metadata.matches.length, 2);
        assert.ok(metadata.matches.every((match) => match.content.length === 3 * MIB));

        const diff = await http.client.callTool(
          { name: 'diff', arguments: { a: diffA, b: diffB } },
          { timeout: 5000 },
        );
        assert.notStrictEqual(diff.isError, true);
        assert.ok(Buffer.byteLength(JSON.stringify(diff), 'utf8') > 10 * MIB);

        for (const path of [resourceFile, binaryFile]) {
          const resource = await http.client.readResource(
            { uri: buildFileResourceUri(path) },
            { timeout: 5000 },
          );
          assert.ok(Buffer.byteLength(JSON.stringify(resource), 'utf8') > 10 * MIB);
        }

        const page = await http.client.callTool(
          {
            name: 'search_text',
            arguments: { path: cachedFile, searchPattern: 'NEEDLE', maxResults: 1 },
          },
          { timeout: 5000 },
        );
        assert.notStrictEqual(page.isError, true);
        const link = page.content.find((block) => block.type === 'resource_link');
        assert.ok(link);
        const cached = await http.client.readResource({ uri: link.uri }, { timeout: 5000 });
        assert.ok(Buffer.byteLength(JSON.stringify(cached), 'utf8') > 10 * MIB);
      } finally {
        await http.close();
      }
    });
  });
});
