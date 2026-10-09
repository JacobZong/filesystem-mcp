import type { ContentBlock } from '@modelcontextprotocol/server';

import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

import * as z from 'zod/v4';

import { ErrorCode, FsError, isNodeError } from '../core/errors.ts';
import { RequiredPath } from '../core/schema.ts';
import { MIB } from '../core/util.ts';
import { defineTool } from './define.ts';

const execFileAsync = promisify(execFile);

/** Pages rendered per call; a longer range is cut and a continuation is returned. */
const MAX_PAGES_PER_CALL = 10;
/** Total PNG bytes per call; rendering stops at the page that would cross it. */
const MAX_TOTAL_IMAGE_BYTES = 12 * MIB;
const MAX_TEXT_CHARS_PER_PAGE = 4000;
const PAGE_RENDER_TIMEOUT_MS = 60_000;
const PDF_MAGIC = '%PDF-';

const ReadPdfPagesInputSchema = z.strictObject({
  path: RequiredPath.describe('PDF file inside an allowed workspace root.'),
  pages: z
    .string()
    .regex(/^\s*\d+\s*(-\s*\d+\s*)?$/u, { message: 'Use a page or range like "3" or "1-3"' })
    .default('1')
    .describe(
      `1-indexed page or range, e.g. "3" or "1-3" (max ${String(MAX_PAGES_PER_CALL)} pages per call; default "1")`,
    ),
  dpi: z
    .int()
    .min(36, { message: 'Min: 36' })
    .max(300, { message: 'Max: 300' })
    .default(150)
    .describe('Render resolution (default 150; lower it for large pages or many pages)'),
  includeText: z
    .boolean()
    .default(true)
    .describe(
      'Also return the extracted text layer (may be garbled when fonts lack Unicode maps; trust the image)',
    ),
});

interface PdfPageInfo {
  page: number;
  bytes: number;
}

interface ReadPdfPagesOutput {
  path: string;
  totalPages: number;
  dpi: number;
  rendered: PdfPageInfo[];
  next?: { tool: 'read_pdf_pages'; args: { path: string; pages: string }; reason: string };
}

function parsePageRange(spec: string): { first: number; last: number } {
  const [rawFirst, rawLast] = spec.split('-').map((part) => Number.parseInt(part.trim(), 10));
  const first = rawFirst ?? 1;
  const last = rawLast ?? first;
  if (first < 1 || last < first) {
    throw new FsError(
      ErrorCode.INVALID_INPUT,
      `Invalid page range "${spec}": start must be >= 1 and <= end.`,
    );
  }
  return { first, last };
}

/** Runs a poppler binary; a missing binary becomes an actionable error instead of ENOENT. */
async function runPoppler(
  bin: string,
  args: readonly string[],
  signal: AbortSignal,
  encoding: 'buffer' | 'utf8',
): Promise<Buffer | string> {
  try {
    const { stdout } = await execFileAsync(bin, args, {
      encoding,
      maxBuffer: MAX_TOTAL_IMAGE_BYTES + 4 * MIB,
      timeout: PAGE_RENDER_TIMEOUT_MS,
      signal,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    signal.throwIfAborted();
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new FsError(
        ErrorCode.IO_ERROR,
        `${bin} is not installed on the server (install poppler-utils).`,
      );
    }
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String(error.stderr).trim()
        : '';
    throw new FsError(ErrorCode.IO_ERROR, `${bin} failed: ${stderr || String(error)}`);
  }
}

async function countPages(validPath: string, signal: AbortSignal): Promise<number> {
  const info = (await runPoppler('pdfinfo', [validPath], signal, 'utf8')) as string;
  const match = /^Pages:\s+(\d+)/mu.exec(info);
  if (!match?.[1]) throw new FsError(ErrorCode.IO_ERROR, 'pdfinfo did not report a page count.');
  return Number.parseInt(match[1], 10);
}

export const READ_PDF_PAGES = defineTool<typeof ReadPdfPagesInputSchema, ReadPdfPagesOutput>({
  name: 'read_pdf_pages',
  title: 'Read PDF Pages',
  description:
    'Render PDF pages to PNG images (returned as image content) plus the text layer, so scanned or ' +
    `oddly-encoded PDFs can be read visually. Up to ${String(MAX_PAGES_PER_CALL)} pages per call.`,
  input: ReadPdfPagesInputSchema,
  readOnlyHint: true,
  timeoutMs: PAGE_RENDER_TIMEOUT_MS * 3,
  defaultErrorCode: ErrorCode.NOT_FILE,
  progress: (args) => ({ label: 'Read PDF', subject: basename(args.path), scope: args.pages }),
  accessPaths: (args) => [args.path],
  run: async (args, ctx) => {
    const { stats, validPath } = await ctx.fs.stat(args.path, { signal: ctx.signal });
    if (!stats.isFile()) throw new FsError(ErrorCode.NOT_FILE, 'Not a file.', args.path);
    const head = await ctx.fs.readLeadingSample(args.path, PDF_MAGIC.length);
    if (head.toString('latin1') !== PDF_MAGIC) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        'Not a PDF file (missing %PDF- header).',
        args.path,
      );
    }

    const totalPages = await countPages(validPath, ctx.signal);
    const { first, last: requestedLast } = parsePageRange(args.pages);
    if (first > totalPages) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        `Page ${String(first)} is out of range: the PDF has ${String(totalPages)} pages.`,
        args.path,
      );
    }
    const wantedLast = Math.min(requestedLast, totalPages);
    const cappedLast = Math.min(wantedLast, first + MAX_PAGES_PER_CALL - 1);

    const images: ContentBlock[] = [];
    const rendered: PdfPageInfo[] = [];
    let totalBytes = 0;
    let budgetHit = false;
    for (let page = first; page <= cappedLast; page += 1) {
      ctx.onProgress({ current: page - first, total: cappedLast - first + 1 });
      const p = String(page);
      const png = (await runPoppler(
        'pdftoppm',
        ['-f', p, '-l', p, '-r', String(args.dpi), '-png', '-singlefile', validPath],
        ctx.signal,
        'buffer',
      )) as Buffer;
      // Always return at least one page, even when it alone exceeds the budget.
      if (rendered.length > 0 && totalBytes + png.length > MAX_TOTAL_IMAGE_BYTES) {
        budgetHit = true;
        break;
      }
      totalBytes += png.length;
      rendered.push({ page, bytes: png.length });
      images.push({ type: 'image', data: png.toString('base64'), mimeType: 'image/png' });
    }

    const lastRendered = rendered.at(-1)?.page ?? first;
    let next: ReadPdfPagesOutput['next'];
    if (lastRendered < wantedLast) {
      const nextFirst = lastRendered + 1;
      next = {
        tool: 'read_pdf_pages',
        args: { path: args.path, pages: `${String(nextFirst)}-${String(wantedLast)}` },
        reason: budgetHit
          ? `image size budget (${String(MAX_TOTAL_IMAGE_BYTES / MIB)} MiB) reached; lower dpi or continue`
          : `max ${String(MAX_PAGES_PER_CALL)} pages per call`,
      };
    }

    const lines = [
      `${basename(args.path)}: pages ${String(first)}-${String(lastRendered)} of ${String(totalPages)} rendered at ${String(args.dpi)} dpi as PNG images (in page order).`,
    ];
    if (next)
      lines.push(
        `// truncated: ${next.reason}. Continue: read_pdf_pages ${JSON.stringify(next.args)}`,
      );
    if (args.includeText) {
      const text = (await runPoppler(
        'pdftotext',
        [
          '-f',
          String(first),
          '-l',
          String(lastRendered),
          '-layout',
          '-enc',
          'UTF-8',
          validPath,
          '-',
        ],
        ctx.signal,
        'utf8',
      )) as string;
      // pdftotext ends every page with a form feed.
      const pageTexts = text.split('\f');
      lines.push(
        '// Text layer below can be garbled when the PDF fonts lack Unicode maps; the images are authoritative.',
      );
      rendered.forEach(({ page }, i) => {
        const body = (pageTexts[i] ?? '').trim();
        const clipped =
          body.length > MAX_TEXT_CHARS_PER_PAGE
            ? `${body.slice(0, MAX_TEXT_CHARS_PER_PAGE)}\n// [text clipped]`
            : body;
        lines.push(`--- page ${String(page)} text ---`, clipped || '(no text layer)');
      });
    }

    return {
      structured: {
        path: args.path,
        totalPages,
        dpi: args.dpi,
        rendered,
        ...(next ? { next } : {}),
      },
      text: lines.join('\n'),
      resources: images,
    };
  },
});
