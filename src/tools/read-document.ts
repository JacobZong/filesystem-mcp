import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, resolve, sep } from 'node:path';

import * as z from 'zod/v4';

import { ErrorCode, FsError } from '../core/errors.ts';
import { runBinary } from '../core/exec.ts';
import { detectMimeType } from '../core/mime.ts';
import { RequiredPath } from '../core/schema.ts';
import { MIB, parseEnvInt } from '../core/util.ts';
import type { ToolDef } from './define.ts';
import { defineTool } from './define.ts';

const CONVERT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_CHARS = 30_000;
const KINDLE_EXTS = new Set(['.azw3', '.azw', '.mobi', '.prc']);
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
const PAGE_EXTS = new Set(['.pdf', '.djvu', '.djv']);
const AUDIO_EXTS = new Set([
  '.mp3',
  '.wma',
  '.wav',
  '.flac',
  '.aac',
  '.m4a',
  '.ogg',
  '.opus',
  '.ape',
  '.amr',
]);

const ReadDocumentInputSchema = z.strictObject({
  path: RequiredPath.describe('Document inside an allowed workspace root.'),
  offset: z
    .int()
    .min(0, { message: 'Min: 0' })
    .default(0)
    .describe(
      'Character offset into the converted Markdown (default 0); use the returned continuation',
    ),
  maxChars: z
    .int()
    .min(1000, { message: 'Min: 1000' })
    .max(100_000, { message: 'Max: 100000' })
    .default(DEFAULT_MAX_CHARS)
    .describe(`Characters to return (default ${String(DEFAULT_MAX_CHARS)})`),
});

interface ReadDocumentOutput {
  path: string;
  via: string;
  totalChars: number;
  offset: number;
  returnedChars: number;
  next?: { tool: 'read_document'; args: { path: string; offset: number; maxChars: number } };
}

interface Converted {
  text: string;
  via: string;
}

// SIMPLIFIED: a tiny in-process cache so paging through one book does not
// re-convert it per page. Keyed by path+mtime+size; 4 entries. Replace with a
// size-bounded LRU if many large documents are paged concurrently.
const CACHE_ENTRIES = 4;
const cache = new Map<string, Converted>();

function remember(key: string, value: Converted): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Image links point at files inside the archive the model cannot fetch; keep only their alt text. */
function cleanMarkdown(markdown: string): string {
  return markdown
    .replace(/\\?!\[([^\]]*)\]\([^)]*\)/gu, (_m, alt: string) =>
      alt.trim() ? `[image: ${alt.trim()}]` : '',
    )
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

async function convertWithServer(
  bytes: Buffer,
  fileName: string,
  signal: AbortSignal,
): Promise<string> {
  const base = process.env['FS_CONVERTER_URL'];
  if (!base) {
    throw new FsError(
      ErrorCode.IO_ERROR,
      'No document converter is configured on this server (FS_CONVERTER_URL).',
    );
  }
  const form = new FormData();
  form.append('files', new Blob([new Uint8Array(bytes)]), fileName);
  form.append('output_format', 'markdown');
  let response: Response;
  try {
    response = await fetch(new URL('/extract', base), {
      method: 'POST',
      body: form,
      signal: AbortSignal.any([signal, AbortSignal.timeout(CONVERT_TIMEOUT_MS)]),
    });
  } catch (error) {
    signal.throwIfAborted();
    throw new FsError(ErrorCode.IO_ERROR, `Document converter unreachable: ${String(error)}`);
  }
  const body = (await response.json().catch(() => undefined)) as
    { results?: { content?: string }[]; errors?: { message?: string }[] } | undefined;
  const content = body?.results?.[0]?.content;
  if (response.ok && typeof content === 'string') return content;
  const message = body?.errors?.[0]?.message ?? `HTTP ${String(response.status)}`;
  throw new FsError(ErrorCode.INVALID_INPUT, `Converter could not read this file: ${message}`);
}

/** Unpacks an unencrypted Kindle book to EPUB/HTML with the `mobi` package, returning its bytes. */
async function unpackKindle(
  validPath: string,
  signal: AbortSignal,
): Promise<{ bytes: Buffer; name: string }> {
  const python = process.env['FS_MOBI_PYTHON'] ?? 'python3';
  const out = await runBinary(
    python,
    ['-c', 'import json,sys,mobi; print(json.dumps(mobi.extract(sys.argv[1])))', validPath],
    { signal, timeoutMs: CONVERT_TIMEOUT_MS, maxOutputBytes: MIB },
  );
  const [tempDir, outFile] = JSON.parse(out.toString('utf8')) as [string, string];
  const tmpRoot = resolve(tmpdir()) + sep;
  try {
    if (!resolve(outFile).startsWith(tmpRoot)) {
      throw new FsError(ErrorCode.IO_ERROR, 'Kindle unpacker wrote outside the temp directory.');
    }
    return { bytes: await readFile(outFile), name: basename(outFile) };
  } finally {
    // Only ever remove the unpacker's own directory under the temp root.
    if (resolve(tempDir).startsWith(tmpRoot)) await rm(tempDir, { recursive: true, force: true });
  }
}

async function convert(validPath: string, ext: string, signal: AbortSignal): Promise<Converted> {
  if (ext === '.doc') {
    try {
      const text = await runBinary('antiword', ['-m', 'UTF-8.txt', validPath], {
        signal,
        timeoutMs: CONVERT_TIMEOUT_MS,
      });
      return { text: text.toString('utf8'), via: 'antiword' };
    } catch {
      signal.throwIfAborted();
      // Not a Word 97+ binary (RTF or HTML saved as .doc): the converter sniffs the real type.
    }
  }
  if (KINDLE_EXTS.has(ext)) {
    const { bytes, name } = await unpackKindle(validPath, signal);
    return { text: await convertWithServer(bytes, name, signal), via: 'mobi + converter' };
  }
  const bytes = await readFile(validPath, { signal });
  return { text: await convertWithServer(bytes, basename(validPath), signal), via: 'converter' };
}

const readDocumentDef: ToolDef<typeof ReadDocumentInputSchema, ReadDocumentOutput> = {
  name: 'read_document',
  title: 'Read Document',
  description:
    'Convert e-books (EPUB, AZW3/MOBI, FB2), Office files (DOC/DOCX, XLS/XLSX, PPT/PPTX, ODF, iWork), ' +
    'archives (ZIP, 7Z, TAR), email, RTF and similar files to Markdown and return it in pages by character offset.',
  input: ReadDocumentInputSchema,
  readOnlyHint: true,
  timeoutMs: CONVERT_TIMEOUT_MS + 30_000,
  defaultErrorCode: ErrorCode.NOT_FILE,
  progress: (args) => ({ label: 'Read document', subject: basename(args.path) }),
  mapPaths: (args, fn) => ({ ...args, path: fn(args.path) }),
  run: async (args, ctx) => {
    const { stats, validPath } = await ctx.fs.stat(args.path, { signal: ctx.signal });
    if (!stats.isFile()) throw new FsError(ErrorCode.NOT_FILE, 'Not a file.', args.path);
    const ext = extname(validPath).toLowerCase();
    if (PAGE_EXTS.has(ext)) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        'Use read_pdf_pages for PDF and DjVu files.',
        args.path,
      );
    }
    if (VIDEO_EXTS.has(ext)) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        'Use read_video_frames for video files.',
        args.path,
      );
    }
    const kind = detectMimeType(validPath).kind;
    if (kind === 'image') {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        'Use read for images; they are returned as image content.',
        args.path,
      );
    }
    if (kind === 'audio' || AUDIO_EXTS.has(ext)) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        'Audio transcription is not available on this server.',
        args.path,
      );
    }
    const maxBytes = parseEnvInt('FS_CONVERT_MAX_BYTES', 100 * MIB, MIB, 1024 * MIB);
    if (stats.size > maxBytes) {
      throw new FsError(
        ErrorCode.TOO_LARGE,
        `File is ${String(Math.round(stats.size / MIB))} MiB; conversion limit is ${String(Math.round(maxBytes / MIB))} MiB.`,
        args.path,
      );
    }

    const key = `${validPath}\0${String(stats.mtimeMs)}\0${String(stats.size)}`;
    let converted = cache.get(key);
    if (!converted) {
      const raw = await convert(validPath, ext, ctx.signal);
      converted = { text: cleanMarkdown(raw.text), via: raw.via };
    }
    remember(key, converted);

    const total = converted.text.length;
    if (args.offset > 0 && args.offset >= total) {
      throw new FsError(
        ErrorCode.INVALID_INPUT,
        `Offset ${String(args.offset)} is past the end (${String(total)} chars).`,
        args.path,
      );
    }
    const slice = converted.text.slice(args.offset, args.offset + args.maxChars);
    const end = args.offset + slice.length;
    const next =
      end < total
        ? {
            tool: 'read_document' as const,
            args: { path: args.path, offset: end, maxChars: args.maxChars },
          }
        : undefined;

    const header = `// ${basename(args.path)}: chars ${String(args.offset)}-${String(end)} of ${String(total)} (Markdown via ${converted.via})`;
    const lines = [header, total === 0 ? '(no text could be extracted)' : slice];
    if (next) lines.push('', `// truncated: Continue: read_document ${JSON.stringify(next.args)}`);
    return {
      structured: {
        path: args.path,
        via: converted.via,
        totalChars: total,
        offset: args.offset,
        returnedChars: slice.length,
        ...(next ? { next } : {}),
      },
      text: lines.join('\n'),
    };
  },
};

export const READ_DOCUMENT = defineTool(readDocumentDef);
/** The tool body, reused by `read` when it routes a binary file here. */
export const runReadDocument: ToolDef<typeof ReadDocumentInputSchema, ReadDocumentOutput>['run'] =
  readDocumentDef.run;
export { ReadDocumentInputSchema };
