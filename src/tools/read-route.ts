import { extname } from 'node:path';

import { ErrorCode, FsError } from '../core/errors.ts';
import type { ToolCtx } from './define.ts';
import { ReadDocumentInputSchema, runReadDocument } from './read-document.ts';
import { ReadPdfPagesInputSchema, runReadPdfPages } from './read-pdf-pages.ts';
import { ReadVideoFramesInputSchema, runReadVideoFrames } from './read-video-frames.ts';

/** Formats `read` hands to read_pdf_pages (first pages as images + text layer). */
const PAGE_EXTS = new Set(['.pdf', '.djvu', '.djv']);
/** Formats `read` hands to read_video_frames. */
const VIDEO_EXTS = new Set([
  '.mp4',
  '.m4v',
  '.mov',
  '.mkv',
  '.avi',
  '.flv',
  '.wmv',
  '.webm',
  '.mpg',
  '.mpeg',
  '.ts',
  '.3gp',
]);
/** MPEG-TS packets are 188 bytes, each starting with the 0x47 sync byte. */
const TS_PACKET_BYTES = 188;
const TS_SYNC_BYTE = 0x47;

/**
 * `.ts` is also TypeScript source: only route it as video when the file
 * starts with two MPEG-TS packets, so a .ts source file stays a text read.
 */
async function isMpegTransportStream(path: string, ctx: ToolCtx): Promise<boolean> {
  const head = await ctx.fs.readLeadingSample(path);
  return head[0] === TS_SYNC_BYTE && head[TS_PACKET_BYTES] === TS_SYNC_BYTE;
}
/** Formats `read` hands to read_document (converted to Markdown). */
const DOCUMENT_EXTS = new Set([
  '.epub',
  '.azw3',
  '.azw',
  '.mobi',
  '.prc',
  '.fb2',
  '.doc',
  '.docx',
  '.docm',
  '.dot',
  '.dotx',
  '.odt',
  '.rtf',
  '.pages',
  '.wpd',
  '.xls',
  '.xlsx',
  '.xlsm',
  '.xlsb',
  '.ods',
  '.numbers',
  '.ppt',
  '.pptx',
  '.pptm',
  '.pps',
  '.ppsx',
  '.odp',
  '.key',
  '.zip',
  '.7z',
  '.tar',
  '.tgz',
  '.gz',
  '.eml',
  '.msg',
]);

const AUTO_PAGES = '1-3';

interface ReadArgsLike {
  path?: string | undefined;
  paths?: readonly string[] | undefined;
  head?: number | undefined;
  tail?: number | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
  binary?: boolean | undefined;
}

/** Whatever the routed tool returned; `read` passes it through unchanged. */
type Routed = object;

/** Prefix the routed tool's text so the model knows which tool to call for more. */
function annotate<T>(result: T, note: string): T {
  const r = result as { text?: string };
  if (typeof r.text === 'string') r.text = `${note}\n${r.text}`;
  return result;
}

/**
 * `read` on a single binary file that one of the document tools can open:
 * PDF/DjVu -> first pages as images, e-book/Office/archive -> Markdown,
 * video -> keyframes. Returns undefined for everything else (text, images,
 * audio, batches, line-range reads) so `read` continues unchanged.
 */
export async function routeBinaryRead(
  args: ReadArgsLike,
  ctx: ToolCtx,
): Promise<Routed | undefined> {
  if (args.path === undefined || args.paths !== undefined) return undefined;
  // binary: true asks for the raw file, so it is never routed.
  if (args.binary === true) return undefined;
  if ([args.head, args.tail, args.startLine, args.endLine].some((v) => v !== undefined)) {
    return undefined;
  }
  const ext = extname(args.path).toLowerCase();
  if (PAGE_EXTS.has(ext)) {
    const result = await runReadPdfPages(
      ReadPdfPagesInputSchema.parse({ path: args.path, pages: AUTO_PAGES }),
      ctx,
    );
    return annotate(
      result,
      `// read routed this ${ext} file to read_pdf_pages (pages ${AUTO_PAGES}); call read_pdf_pages with "pages" for more.`,
    );
  }
  if (VIDEO_EXTS.has(ext) && (ext !== '.ts' || (await isMpegTransportStream(args.path, ctx)))) {
    const result = await runReadVideoFrames(
      ReadVideoFramesInputSchema.parse({ path: args.path }),
      ctx,
    );
    return annotate(
      result,
      '// read routed this video to read_video_frames; call it directly to choose frames, start or end.',
    );
  }
  if (DOCUMENT_EXTS.has(ext)) {
    try {
      const result = await runReadDocument(ReadDocumentInputSchema.parse({ path: args.path }), ctx);
      return annotate(
        result,
        `// read converted this ${ext} file with read_document; use read_document with "offset" to page through it.`,
      );
    } catch (error) {
      // The converter is optional: without it, fall back to read's own answer.
      if (
        error instanceof FsError &&
        error.code === ErrorCode.IO_ERROR &&
        error.message.includes('No document converter')
      ) {
        return undefined;
      }
      throw error;
    }
  }
  return undefined;
}
