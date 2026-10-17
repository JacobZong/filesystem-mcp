import type { ContentBlock } from '@modelcontextprotocol/server';

import { basename } from 'node:path';

import * as z from 'zod/v4';

import { ErrorCode, FsError } from '../core/errors.ts';
import { runBinary } from '../core/exec.ts';
import { RequiredPath } from '../core/schema.ts';
import { MIB } from '../core/util.ts';
import type { ToolDef } from './define.ts';
import { defineTool } from './define.ts';

/** Pages rendered per call; a longer range is cut and a continuation is returned. */
const MAX_PAGES_PER_CALL = 10;
/** Total PNG bytes per call; rendering stops at the page that would cross it. */
const MAX_TOTAL_IMAGE_BYTES = 12 * MIB;
const MAX_TEXT_CHARS_PER_PAGE = 4000;
const PAGE_RENDER_TIMEOUT_MS = 60_000;
const PDF_MAGIC = '%PDF-';
const DJVU_MAGIC = 'AT&TFORM';

const ReadPdfPagesInputSchema = z.strictObject({
  path: RequiredPath.describe('PDF or DjVu file inside an allowed workspace root.'),
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

interface PageSource {
  readonly kind: 'PDF' | 'DjVu';
  countPages(): Promise<number>;
  renderPng(page: number, dpi: number): Promise<Buffer>;
  /** Text layer per page, in order, for pages first..last. */
  pageTexts(first: number, last: number): Promise<string[]>;
}

const IMAGE_OUTPUT_LIMIT = MAX_TOTAL_IMAGE_BYTES + 4 * MIB;

function pdfSource(validPath: string, signal: AbortSignal): PageSource {
  const opts = { signal, timeoutMs: PAGE_RENDER_TIMEOUT_MS, maxOutputBytes: IMAGE_OUTPUT_LIMIT };
  return {
    kind: 'PDF',
    countPages: async () => {
      const info = (await runBinary('pdfinfo', [validPath], opts)).toString('utf8');
      const match = /^Pages:\s+(\d+)/mu.exec(info);
      if (!match?.[1])
        throw new FsError(ErrorCode.IO_ERROR, 'pdfinfo did not report a page count.');
      return Number.parseInt(match[1], 10);
    },
    renderPng: (page, dpi) => {
      const p = String(page);
      return runBinary(
        'pdftoppm',
        ['-f', p, '-l', p, '-r', String(dpi), '-png', '-singlefile', validPath],
        opts,
      );
    },
    pageTexts: async (first, last) => {
      const text = await runBinary(
        'pdftotext',
        ['-f', String(first), '-l', String(last), '-layout', '-enc', 'UTF-8', validPath, '-'],
        opts,
      );
      // pdftotext ends every page with a form feed.
      return text.toString('utf8').split('\f');
    },
  };
}

function djvuSource(validPath: string, signal: AbortSignal): PageSource {
  const opts = { signal, timeoutMs: PAGE_RENDER_TIMEOUT_MS, maxOutputBytes: 256 * MIB };
  return {
    kind: 'DjVu',
    countPages: async () => {
      const out = (await runBinary('djvused', ['-e', 'n', validPath], opts)).toString('utf8');
      const count = Number.parseInt(out.trim(), 10);
      if (!Number.isFinite(count))
        throw new FsError(ErrorCode.IO_ERROR, 'djvused did not report a page count.');
      return count;
    },
    // ddjvu's -scale is the output resolution in dpi; it only writes PNM, so ffmpeg re-encodes to PNG.
    renderPng: async (page, dpi) => {
      const pnm = await runBinary(
        'ddjvu',
        ['-format=pnm', `-page=${String(page)}`, `-scale=${String(dpi)}`, validPath, '-'],
        opts,
      );
      return runBinary(
        'ffmpeg',
        [
          '-loglevel',
          'error',
          '-f',
          'image2pipe',
          '-i',
          'pipe:0',
          '-frames:v',
          '1',
          '-c:v',
          'png',
          '-f',
          'image2pipe',
          'pipe:1',
        ],
        { ...opts, input: pnm, maxOutputBytes: IMAGE_OUTPUT_LIMIT },
      );
    },
    pageTexts: async (first, last) => {
      const texts: string[] = [];
      for (let page = first; page <= last; page += 1) {
        const out = await runBinary('djvutxt', [`--page=${String(page)}`, validPath], opts);
        texts.push(out.toString('utf8'));
      }
      return texts;
    },
  };
}

const readPdfPagesDef: ToolDef<typeof ReadPdfPagesInputSchema, ReadPdfPagesOutput> = {
  name: 'read_pdf_pages',
  title: 'Read PDF Pages',
  description:
    'Render PDF or DjVu pages to PNG images (returned as image content) plus the text layer, so scanned or ' +
    `oddly-encoded documents can be read visually. Up to ${String(MAX_PAGES_PER_CALL)} pages per call.`,
  input: ReadPdfPagesInputSchema,
  readOnlyHint: true,
  timeoutMs: PAGE_RENDER_TIMEOUT_MS * 3,
  defaultErrorCode: ErrorCode.NOT_FILE,
  progress: (args) => ({ label: 'Read PDF', subject: basename(args.path), scope: args.pages }),
  mapPaths: (args, fn) => ({ ...args, path: fn(args.path) }),
  run: async (args, ctx) => {
    const { stats, validPath } = await ctx.fs.stat(args.path, { signal: ctx.signal });
    if (!stats.isFile()) throw new FsError(ErrorCode.NOT_FILE, 'Not a file.', args.path);
    const head = (await ctx.fs.readLeadingSample(args.path))
      .subarray(0, DJVU_MAGIC.length)
      .toString('latin1');
    let source: PageSource;
    if (head.startsWith(PDF_MAGIC)) source = pdfSource(validPath, ctx.signal);
    else if (head === DJVU_MAGIC) source = djvuSource(validPath, ctx.signal);
    else {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        'Not a PDF or DjVu file (missing %PDF- or AT&TFORM header).',
        args.path,
      );
    }

    const totalPages = await source.countPages();
    const { first, last: requestedLast } = parsePageRange(args.pages);
    if (first > totalPages) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        `Page ${String(first)} is out of range: the ${source.kind} has ${String(totalPages)} pages.`,
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
      const png = await source.renderPng(page, args.dpi);
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
      const pageTexts = await source.pageTexts(first, lastRendered);
      lines.push(
        '// Text layer below can be garbled or missing (fonts without Unicode maps, scans); the images are authoritative.',
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
};

export const READ_PDF_PAGES = defineTool(readPdfPagesDef);
/** The tool body, reused by `read` when it routes a binary file here. */
export const runReadPdfPages: ToolDef<typeof ReadPdfPagesInputSchema, ReadPdfPagesOutput>['run'] =
  readPdfPagesDef.run;
export { ReadPdfPagesInputSchema };
