import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  cleanupTestRoot,
  createTestClientPair,
  createTestRoot,
  firstTextBlock,
  type TestClientContext,
} from './helpers.ts';

function hasBinary(bin: string, arg: string): boolean {
  try {
    execFileSync(bin, [arg], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface Block {
  type: string;
  mimeType?: string;
}

describe('read_document', () => {
  let tmpDir: string;
  let harness: TestClientContext;
  let converter: Server;
  let received: string[] = [];
  const previousUrl = process.env['FS_CONVERTER_URL'];

  before(async () => {
    tmpDir = await createTestRoot();
    harness = await createTestClientPair([tmpDir]);
    // Stand-in for the Xberg sidecar: echoes a fixed Markdown body.
    converter = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        received.push(
          `${req.method ?? ''} ${req.url ?? ''} ${Buffer.concat(chunks).toString('latin1').includes('name="output_format"') ? 'fmt' : ''}`,
        );
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            results: [{ content: `# Title\n\n![cover](img/cover.jpg)\n\n\n\n${'x'.repeat(2500)}` }],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => converter.listen(0, '127.0.0.1', resolve));
    process.env['FS_CONVERTER_URL'] =
      `http://127.0.0.1:${String((converter.address() as AddressInfo).port)}`;
  });

  after(async () => {
    if (previousUrl === undefined) delete process.env['FS_CONVERTER_URL'];
    else process.env['FS_CONVERTER_URL'] = previousUrl;
    await new Promise<void>((resolve) => converter.close(() => resolve()));
    await harness.close();
    await cleanupTestRoot(tmpDir);
  });

  it('converts through the converter, drops image links and pages by offset', async () => {
    const file = join(tmpDir, 'book.epub');
    await writeFile(file, 'PK fake epub');
    received = [];
    const first = await harness.client.callTool({
      name: 'read_document',
      arguments: { path: file, maxChars: 1000 },
    });
    assert.notStrictEqual(first.isError, true);
    const text = firstTextBlock(first).text ?? '';
    assert.match(text, /chars 0-1000 of \d+ \(Markdown via converter\)/);
    assert.match(text, /\[image: cover\]/);
    assert.doesNotMatch(text, /img\/cover\.jpg/);
    assert.match(text, /Continue: read_document .*"offset":1000/);
    assert.deepStrictEqual(received, ['POST /extract fmt']);

    // The second page comes from the cache: no new converter request.
    const second = await harness.client.callTool({
      name: 'read_document',
      arguments: { path: file, offset: 1000, maxChars: 1000 },
    });
    assert.match(firstTextBlock(second).text ?? '', /chars 1000-2000 of/);
    assert.strictEqual(received.length, 1);
  });

  it('routes PDF, video and audio to the right answer instead of converting', async () => {
    for (const [name, pattern] of [
      ['a.pdf', /read_pdf_pages/],
      ['a.mp4', /read_video_frames/],
      ['a.wma', /Audio transcription is not available/],
    ] as const) {
      const file = join(tmpDir, name);
      await writeFile(file, 'x');
      const result = await harness.client.callTool({
        name: 'read_document',
        arguments: { path: file },
      });
      assert.strictEqual(result.isError, true);
      assert.match(firstTextBlock(result).text ?? '', pattern);
    }
  });
});

describe(
  'read_video_frames',
  { skip: hasBinary('ffmpeg', '-version') ? false : 'ffmpeg not installed' },
  () => {
    let tmpDir: string;
    let harness: TestClientContext;

    before(async () => {
      tmpDir = await createTestRoot();
      harness = await createTestClientPair([tmpDir]);
      execFileSync('ffmpeg', [
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=3:size=320x240:rate=10',
        '-pix_fmt',
        'yuv420p',
        join(tmpDir, 'clip.mp4'),
      ]);
    });

    after(async () => {
      await harness.close();
      await cleanupTestRoot(tmpDir);
    });

    it('returns evenly spaced JPEG frames with duration and stream info', async () => {
      const result = await harness.client.callTool({
        name: 'read_video_frames',
        arguments: { path: join(tmpDir, 'clip.mp4'), frames: 3, width: 320 },
      });
      assert.notStrictEqual(result.isError, true);
      const images = (result.content as Block[]).filter((b) => b.type === 'image');
      assert.strictEqual(images.length, 3);
      assert.ok(images.every((b) => b.mimeType === 'image/jpeg'));
      const text = firstTextBlock(result).text ?? '';
      assert.match(text, /duration 00:03, video h264 320x240/);
      assert.match(text, /Frames \(in order\) at: 00:00, 00:01, 00:02/);
    });

    it('rejects files without a video stream', async () => {
      const file = join(tmpDir, 'not-video.mp4');
      await writeFile(file, 'nope');
      const result = await harness.client.callTool({
        name: 'read_video_frames',
        arguments: { path: file },
      });
      assert.strictEqual(result.isError, true);
      assert.match(firstTextBlock(result).text ?? '', /Not a readable video file/);
    });
  },
);
