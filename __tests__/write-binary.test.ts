import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  cleanupTestRoot,
  createTestClientPair,
  createTestRoot,
  firstTextBlock,
  type TestClientContext,
  withEnv,
} from './helpers.ts';

// Bytes that are not valid UTF-8 and include NUL: a text round-trip would corrupt them.
const BYTES = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0xff, 0xfe, 0x80, 0x00, 0x7f, 0xc3]);
const B64 = BYTES.toString('base64');
const SHA = createHash('sha256').update(BYTES).digest('hex');

/** The tool answers in text: "Created|Replaced <path> (<n> bytes, sha256 <hex>)". */
function parse(text: string | undefined): { verb: string; size: number; sha256: string } {
  const m = /^(Created|Replaced) .+ \((\d+) bytes, sha256 ([0-9a-f]{64})\)$/u.exec(text ?? '');
  assert.ok(m, `unexpected result text: ${String(text)}`);
  return { verb: m[1] ?? '', size: Number(m[2]), sha256: m[3] ?? '' };
}

describe('write_binary', () => {
  let tmpDir: string;
  let harness: TestClientContext;

  before(async () => {
    tmpDir = await createTestRoot();
    harness = await createTestClientPair([tmpDir]);
  });

  after(async () => {
    await harness.close();
    await cleanupTestRoot(tmpDir);
  });

  it('writes the exact bytes, creating parent folders, and reports size and sha256', async () => {
    const target = join(tmpDir, 'learning', '2026-10-11', 'ja', 'shadow-L1.mp3');
    const result = await harness.client.callTool({
      name: 'write_binary',
      arguments: { path: target, data_base64: B64, sha256: SHA },
    });
    assert.notStrictEqual(result.isError, true, firstTextBlock(result).text);
    const out = parse(firstTextBlock(result).text);
    assert.strictEqual(out.size, BYTES.length);
    assert.strictEqual(out.sha256, SHA);
    assert.strictEqual(out.verb, 'Created');
    assert.deepStrictEqual(await readFile(target), BYTES);
  });

  it('refuses an existing file without overwrite and replaces it with overwrite', async () => {
    const target = join(tmpDir, 'existing.mp3');
    await writeFile(target, 'old');
    const refused = await harness.client.callTool({
      name: 'write_binary',
      arguments: { path: target, data_base64: B64 },
    });
    assert.strictEqual(refused.isError, true);
    assert.strictEqual(await readFile(target, 'utf8'), 'old');

    const replaced = await harness.client.callTool({
      name: 'write_binary',
      arguments: { path: target, data_base64: B64, overwrite: true },
    });
    assert.notStrictEqual(replaced.isError, true, firstTextBlock(replaced).text);
    assert.strictEqual(parse(firstTextBlock(replaced).text).verb, 'Replaced');
    assert.deepStrictEqual(await readFile(target), BYTES);
  });

  it('writes nothing when the sha256 does not match or the base64 is malformed', async () => {
    const target = join(tmpDir, 'mismatch.mp3');
    const mismatch = await harness.client.callTool({
      name: 'write_binary',
      arguments: { path: target, data_base64: B64, sha256: '0'.repeat(64) },
    });
    assert.strictEqual(mismatch.isError, true);
    await assert.rejects(readFile(target));

    const malformed = await harness.client.callTool({
      name: 'write_binary',
      arguments: { path: target, data_base64: 'not base64!' },
    });
    assert.strictEqual(malformed.isError, true);
    await assert.rejects(readFile(target));
  });

  it('has no per-file size limit: a file larger than one call goes up in appended chunks', async () => {
    const big = randomBytes(2_500_000);
    const whole = createHash('sha256').update(big).digest('hex');
    const target = join(tmpDir, 'video', 'large.bin.part');
    await withEnv({ FS_MAX_FILE_SIZE: String(1024 * 1024) }, async () => {
      const single = await harness.client.callTool({
        name: 'write_binary',
        arguments: {
          path: join(tmpDir, 'video', 'single.bin'),
          data_base64: big.toString('base64'),
        },
      });
      assert.strictEqual(single.isError, true, 'one call above FS_MAX_FILE_SIZE must be refused');

      const step = 700_000;
      for (let off = 0; off < big.length; off += step) {
        const chunk = big.subarray(off, off + step);
        const last = off + step >= big.length;
        const res = await harness.client.callTool({
          name: 'write_binary',
          arguments: {
            path: target,
            data_base64: chunk.toString('base64'),
            sha256: createHash('sha256').update(chunk).digest('hex'),
            append: true,
            ...(last ? { file_sha256: whole } : {}),
          },
        });
        assert.notStrictEqual(res.isError, true, firstTextBlock(res).text);
        if (last) assert.match(firstTextBlock(res).text ?? '', /file sha256 [0-9a-f]{64} verified/);
      }
    });
    assert.deepStrictEqual(await readFile(target), big);
  });

  it('reports a whole-file mismatch after the last chunk', async () => {
    const target = join(tmpDir, 'mismatch-whole.bin');
    const res = await harness.client.callTool({
      name: 'write_binary',
      arguments: { path: target, data_base64: B64, append: true, file_sha256: 'f'.repeat(64) },
    });
    assert.strictEqual(res.isError, true);
    assert.match(firstTextBlock(res).text ?? '', /expected f{64}/);
  });

  it('never writes outside the roots, directly or through a symbolic link', async () => {
    const outsideDir = await createTestRoot();
    try {
      const direct = join(outsideDir, 'direct.mp3');
      await harness.client.callTool({
        name: 'write_binary',
        arguments: { path: direct, data_base64: B64 },
      });
      await assert.rejects(readFile(direct));

      const escapee = join(outsideDir, 'escapee.mp3');
      await writeFile(escapee, 'outside');
      const link = join(tmpDir, 'escape-link.mp3');
      await symlink(escapee, link);
      const viaLink = await harness.client.callTool({
        name: 'write_binary',
        arguments: { path: link, data_base64: B64, overwrite: true },
      });
      assert.strictEqual(viaLink.isError, true);
      assert.strictEqual(await readFile(escapee, 'utf8'), 'outside');
    } finally {
      await cleanupTestRoot(outsideDir);
    }
  });
});
