import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { resetIndexForTests } from '../src/core/file-index.ts';
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

/** A one-page PDF with a text line, xref offsets computed. */
function onePagePdf(): Buffer {
  const stream = 'BT /F1 24 Tf 20 50 Td (Hello) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>',
    `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objs.length + 1)}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objs.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

describe('locate', () => {
  let tmpDir: string;
  let harness: TestClientContext;

  before(async () => {
    resetIndexForTests();
    tmpDir = await createTestRoot();
    await mkdir(join(tmpDir, 'books', 'zh'), { recursive: true });
    await mkdir(join(tmpDir, '.hidden'));
    await mkdir(join(tmpDir, '#recycle'));
    await writeFile(join(tmpDir, 'books', 'zh', '大逃港 - 陈秉安.azw3'), 'x');
    await writeFile(join(tmpDir, 'books', 'zh', '大逃港 读书笔记.txt'), 'x');
    await writeFile(join(tmpDir, 'books', 'other.epub'), 'x');
    await writeFile(join(tmpDir, '.hidden', '大逃港 secret.epub'), 'x');
    await writeFile(join(tmpDir, '#recycle', '大逃港 deleted.epub'), 'x');
    await writeFile(join(tmpDir, 'books', 'id_rsa'), 'x');
    harness = await createTestClientPair([tmpDir]);
  });

  after(async () => {
    await harness.close();
    await cleanupTestRoot(tmpDir);
    resetIndexForTests();
  });

  it('finds files by words in the name, ranks name matches first and names the reader', async () => {
    const result = await harness.client.callTool({
      name: 'locate',
      arguments: { query: '大逃港' },
    });
    assert.notStrictEqual(result.isError, true);
    const text = firstTextBlock(result).text ?? '';
    assert.match(text, /2 match\(es\)/);
    assert.match(text, /大逃港 - 陈秉安\.azw3 .*\|\s+read \/ read_document/);
    assert.match(text, /大逃港 读书笔记\.txt .*\|\s+read$/m);
    assert.doesNotMatch(text, /secret\.epub|deleted\.epub/);
  });

  it('filters by extension and never returns denylisted files', async () => {
    const byExt = await harness.client.callTool({
      name: 'locate',
      arguments: { query: '大逃港', ext: 'azw3' },
    });
    const text = firstTextBlock(byExt).text ?? '';
    assert.match(text, /1 match\(es\)/);
    assert.match(text, /\.azw3/);

    const sensitive = await harness.client.callTool({
      name: 'locate',
      arguments: { query: 'id_rsa' },
    });
    assert.match(firstTextBlock(sensitive).text ?? '', /0 match\(es\)/);
  });
});

describe('read routes binary documents', () => {
  let tmpDir: string;
  let harness: TestClientContext;
  let converter: Server;
  const previousUrl = process.env['FS_CONVERTER_URL'];

  before(async () => {
    tmpDir = await createTestRoot();
    harness = await createTestClientPair([tmpDir]);
    converter = createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ results: [{ content: '# Converted chapter\n\nBody text.' }] }));
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

  it('read on an EPUB returns the converted Markdown', async () => {
    const file = join(tmpDir, 'book.epub');
    await writeFile(file, 'PK fake');
    const result = await harness.client.callTool({ name: 'read', arguments: { path: file } });
    assert.notStrictEqual(result.isError, true);
    const text = firstTextBlock(result).text ?? '';
    assert.match(text, /read converted this \.epub file with read_document/);
    assert.match(text, /# Converted chapter/);
  });

  it(
    'read on a PDF returns page images',
    { skip: !hasBinary('pdftoppm', '-v') && 'poppler not installed' },
    async () => {
      const file = join(tmpDir, 'doc.pdf');
      await writeFile(file, onePagePdf());
      const result = await harness.client.callTool({ name: 'read', arguments: { path: file } });
      assert.notStrictEqual(result.isError, true);
      assert.strictEqual((result.content as Block[]).filter((b) => b.type === 'image').length, 1);
      assert.match(
        firstTextBlock(result).text ?? '',
        /read routed this \.pdf file to read_pdf_pages/,
      );
    },
  );

  it(
    'read on a video returns frames',
    { skip: !hasBinary('ffmpeg', '-version') && 'ffmpeg not installed' },
    async () => {
      const file = join(tmpDir, 'clip.mp4');
      execFileSync('ffmpeg', [
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'testsrc=duration=2:size=160x120:rate=10',
        '-pix_fmt',
        'yuv420p',
        file,
      ]);
      const result = await harness.client.callTool({ name: 'read', arguments: { path: file } });
      assert.notStrictEqual(result.isError, true);
      assert.ok((result.content as Block[]).filter((b) => b.type === 'image').length >= 1);
      assert.match(
        firstTextBlock(result).text ?? '',
        /read routed this video to read_video_frames/,
      );
    },
  );

  it('leaves text files, line ranges and batches on the normal read path', async () => {
    const text = join(tmpDir, 'note.txt');
    await writeFile(text, 'plain line\n');
    const plain = await harness.client.callTool({ name: 'read', arguments: { path: text } });
    assert.match(firstTextBlock(plain).text ?? '', /^plain line/);

    const epub = join(tmpDir, 'book.epub');
    const ranged = await harness.client.callTool({
      name: 'read',
      arguments: { path: epub, head: 1 },
    });
    assert.doesNotMatch(firstTextBlock(ranged).text ?? '', /read_document/);
  });

  it('reads a TypeScript .ts file as text, not as an MPEG-TS video', async () => {
    const source = join(tmpDir, 'index.ts');
    await writeFile(source, 'export const NEEDLE = 1;\n');
    const result = await harness.client.callTool({ name: 'read', arguments: { path: source } });
    assert.notStrictEqual(result.isError, true);
    assert.match(firstTextBlock(result).text ?? '', /NEEDLE = 1/);
  });

  it('binary: true returns the raw file instead of routing it', async () => {
    const epub = join(tmpDir, 'raw.epub');
    await writeFile(epub, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0xff, 0x00]));
    const result = await harness.client.callTool({
      name: 'read',
      arguments: { path: epub, binary: true },
    });
    assert.notStrictEqual(result.isError, true);
    assert.doesNotMatch(firstTextBlock(result).text ?? '', /read_document/);
    assert.ok((result.content as Block[]).some((b) => b.type === 'resource'));
  });
});
