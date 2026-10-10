import { extname } from 'node:path';

import * as z from 'zod/v4';

import { ErrorCode } from '../core/errors.ts';
import { ensureIndex, indexStatus, searchIndex } from '../core/file-index.ts';
import { detectMimeType } from '../core/mime.ts';
import { defineTool } from './define.ts';

const WAIT_FOR_INDEX_MS = 25_000;
const DEFAULT_LIMIT = 30;

const LocateInputSchema = z.strictObject({
  query: z
    .string()
    .min(1, { message: 'Query required' })
    .max(200, { message: 'Max 200 chars' })
    .describe(
      'Words to find in file names or folder paths, e.g. "大逃港" or "N5 语法" (all words must match)',
    ),
  ext: z
    .string()
    .max(200)
    .optional()
    .describe('Only these extensions, comma separated, e.g. "epub,azw3,pdf"'),
  limit: z
    .int()
    .min(1, { message: 'Min: 1' })
    .max(200, { message: 'Max: 200' })
    .default(DEFAULT_LIMIT)
    .describe(`Max results (default ${String(DEFAULT_LIMIT)})`),
});

interface LocateHit {
  path: string;
  size: number;
  modified: string;
  reader: string;
}

interface LocateOutput {
  query: string;
  hits: LocateHit[];
  indexedFiles: number;
  indexBuiltAt?: string;
  building: boolean;
}

const PAGE = new Set(['.pdf', '.djvu', '.djv']);
const VIDEO = new Set([
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
const AUDIO = new Set([
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

/** Which tool opens this file (read also routes binaries to the others). */
function readerFor(path: string): string {
  const ext = extname(path).toLowerCase();
  if (PAGE.has(ext)) return 'read / read_pdf_pages';
  if (VIDEO.has(ext)) return 'read / read_video_frames';
  if (AUDIO.has(ext)) return 'not readable (audio)';
  const kind = detectMimeType(path).kind;
  if (kind === 'text' || kind === 'image') return 'read';
  return 'read / read_document';
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${String(bytes)} B`;
}

export const LOCATE = defineTool<typeof LocateInputSchema, LocateOutput>({
  name: 'locate',
  title: 'Locate Files',
  description:
    'Find files by name across all roots in one call using a filename index (rebuilt nightly), like the Unix locate. ' +
    'Use it instead of find_files to look for a book or document by title; returns path, size, date and which tool reads it.',
  input: LocateInputSchema,
  readOnlyHint: true,
  timeoutMs: 60_000,
  defaultErrorCode: ErrorCode.NOT_FOUND,
  progress: (args) => ({ label: 'Locate', subject: args.query }),
  run: async (args, ctx) => {
    const roots = ctx.fs.pathGuard.getAllowedDirectories();
    const build = ensureIndex(roots);
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      build,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, WAIT_FOR_INDEX_MS);
      }),
    ]);
    if (timer) clearTimeout(timer);

    const status = indexStatus();
    if (!status.ready) {
      return {
        structured: { query: args.query, hits: [], indexedFiles: 0, building: true },
        text: `The filename index is still being built (${String(status.scanned)} files so far). Try locate again in a minute, or use find_files on a narrow folder.`,
      };
    }

    const exts = new Set(
      (args.ext ?? '')
        .split(',')
        .map((e) => e.trim().toLowerCase().replace(/^\.?/u, '.'))
        .filter((e) => e.length > 1),
    );
    const terms = args.query.split(/\s+/u).filter(Boolean);
    const hits: LocateHit[] = [];
    // Over-fetch: hits that the guard now refuses (denylist, vanished) are dropped.
    for (const path of searchIndex(terms, exts, args.limit * 3)) {
      if (hits.length >= args.limit) break;
      try {
        const { stats } = await ctx.fs.stat(path, { signal: ctx.signal });
        hits.push({
          path,
          size: stats.size,
          modified: stats.mtime.toISOString().slice(0, 10),
          reader: readerFor(path),
        });
      } catch {
        continue;
      }
    }

    const built =
      status.builtAt !== undefined
        ? new Date(status.builtAt).toISOString().slice(0, 16).replace('T', ' ')
        : '';
    const lines = [
      `${String(hits.length)} match(es) for "${args.query}" in an index of ${String(status.files)} files (built ${built} UTC${status.loadedFromDisk ? ', loaded from disk' : ''}${status.building ? '; refresh running' : ''}${status.truncated ? '; index truncated' : ''}).`,
      ...hits.map((h) => `${h.path}  |  ${formatSize(h.size)}  |  ${h.modified}  |  ${h.reader}`),
    ];
    if (hits.length === 0)
      lines.push(
        'Try fewer or shorter words; files added since the last build appear after the daily refresh.',
      );
    return {
      structured: {
        query: args.query,
        hits,
        indexedFiles: status.files,
        ...(status.builtAt !== undefined
          ? { indexBuiltAt: new Date(status.builtAt).toISOString() }
          : {}),
        building: status.building,
      },
      text: lines.join('\n'),
    };
  },
});
