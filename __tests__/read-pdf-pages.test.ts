import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  cleanupTestRoot,
  createTestClientPair,
  createTestRoot,
  firstTextBlock,
  type TestClientContext,
} from './helpers.ts';

function hasPoppler(): boolean {
  try {
    execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** A valid PDF with one "Page N" text line per page, xref offsets computed. */
function makePdf(pageCount: number): Buffer {
  const objects: string[] = [];
  const pageIds = Array.from({ length: pageCount }, (_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${String(id)} 0 R`).join(' ')}] /Count ${String(pageCount)} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pageIds.forEach((id, i) => {
    const stream = `BT /F1 24 Tf 20 50 Td (Page ${String(i + 1)}) Tj ET`;
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 3 0 R >> >> /Contents ${String(id + 1)} 0 R >>`;
    objects[id + 1] = `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length;
    out += `${String(id)} 0 obj\n${objects[id] ?? ''}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${String(objects.length)}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${String(objects.length)} /Root 1 0 R >>\nstartxref\n${String(xrefAt)}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

interface Block {
  type: string;
  data?: string;
  mimeType?: string;
}

describe('read_pdf_pages', { skip: hasPoppler() ? false : 'poppler-utils not installed' }, () => {
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

  it('renders the requested pages as PNG image blocks with the text layer', async () => {
    const file = join(tmpDir, 'doc.pdf');
    await writeFile(file, makePdf(3));
    const result = await harness.client.callTool({
      name: 'read_pdf_pages',
      arguments: { path: file, pages: '2-3', dpi: 72 },
    });
    assert.notStrictEqual(result.isError, true);
    const images = (result.content as Block[]).filter((b) => b.type === 'image');
    assert.strictEqual(images.length, 2);
    for (const img of images) {
      assert.strictEqual(img.mimeType, 'image/png');
      assert.strictEqual(
        Buffer.from(img.data ?? '', 'base64')
          .subarray(1, 4)
          .toString(),
        'PNG',
      );
    }
    const text = firstTextBlock(result).text ?? '';
    assert.match(text, /pages 2-3 of 3/);
    assert.match(text, /--- page 2 text ---\nPage 2/);
    assert.match(text, /--- page 3 text ---\nPage 3/);
  });

  it('caps a call at 10 pages and returns a continuation', async () => {
    const file = join(tmpDir, 'long.pdf');
    await writeFile(file, makePdf(12));
    const result = await harness.client.callTool({
      name: 'read_pdf_pages',
      arguments: { path: file, pages: '1-12', dpi: 36, includeText: false },
    });
    const images = (result.content as Block[]).filter((b) => b.type === 'image');
    assert.strictEqual(images.length, 10);
    assert.match(firstTextBlock(result).text ?? '', /Continue: read_pdf_pages .*"pages":"11-12"/);
  });

  it('rejects out-of-range pages, non-PDF files and paths outside the roots', async () => {
    const pdf = join(tmpDir, 'one.pdf');
    await writeFile(pdf, makePdf(1));
    const outOfRange = await harness.client.callTool({
      name: 'read_pdf_pages',
      arguments: { path: pdf, pages: '5' },
    });
    assert.strictEqual(outOfRange.isError, true);
    assert.match(firstTextBlock(outOfRange).text ?? '', /out of range/);

    const fake = join(tmpDir, 'fake.pdf');
    await writeFile(fake, 'not a pdf');
    const notPdf = await harness.client.callTool({
      name: 'read_pdf_pages',
      arguments: { path: fake },
    });
    assert.strictEqual(notPdf.isError, true);
    assert.match(firstTextBlock(notPdf).text ?? '', /Not a PDF/);

    const outside = await harness.client.callTool({
      name: 'read_pdf_pages',
      arguments: { path: '/etc/hosts' },
    });
    assert.strictEqual(outside.isError, true);
  });
});
