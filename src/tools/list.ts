import { basename, posix } from 'node:path';

import * as z from 'zod/v4';

import { pageQueryKey, paginate } from '../core/cursor.ts';
import { ErrorCode, isFsError, isSkippableErrno, SKIPPABLE_FS_CODES } from '../core/errors.ts';
import { pageTrailer } from '../core/fmt.ts';
import { globEntries } from '../core/glob.ts';
import { type EntryType, resolveEntryType, toPosixRelative } from '../core/path-utils.ts';
import type { PathGuard } from '../core/path.ts';
import {
  CursorSchema,
  IncludeHidden,
  IncludeIgnored,
  mapOptionalPath,
  OptionalPath,
  PositiveInt,
} from '../core/schema.ts';
import type { JsonResourceResult } from '../core/store.ts';
import { putJsonResource } from '../core/store.ts';
import { DEFAULT_TREE_ENTRIES, MAX_LIST_ENTRIES, MAX_TREE_DEPTH } from '../core/util.ts';
import { defineTool } from './define.ts';

interface CollectedEntry {
  name: string;
  relativePath: string; // POSIX
  type: EntryType;
}

interface CollectOptions {
  maxDepth: number;
  includeHidden: boolean;
  includeIgnored: boolean;
  signal: AbortSignal;
  pathGuard: PathGuard;
  /** Upper bound on the stored, paginable entry array. */
  entryCap: number;
  onProgress: (progress: { current: number; total?: number }) => void;
}

interface CollectResult {
  entries: CollectedEntry[];
  totalEntries: number;
  totalFiles: number;
  totalDirectories: number;
}

function entryTypeRank(type: EntryType): number {
  if (type === 'directory') return 0;
  return 1;
}

function compareEntries(a: CollectedEntry, b: CollectedEntry): number {
  // Compare by parent directory first (depth-level grouping)
  const slashA = a.relativePath.lastIndexOf('/');
  const slashB = b.relativePath.lastIndexOf('/');
  const parentA = slashA === -1 ? '' : a.relativePath.slice(0, slashA);
  const parentB = slashB === -1 ? '' : b.relativePath.slice(0, slashB);

  if (parentA !== parentB) return parentA.localeCompare(parentB);

  // Within same parent: dirs first, then alphabetical
  const rankDiff = entryTypeRank(a.type) - entryTypeRank(b.type);
  if (rankDiff !== 0) return rankDiff;
  return a.name.localeCompare(b.name);
}

/**
 * True when a walked entry is inside the allowed directories and not sensitive,
 * on both its requested and resolved paths. Every entry is realpath-resolved: a
 * symlinked ancestor pointing outside the sandbox would otherwise pass the
 * lexical check (fs.glob follows symlinks and yields external entries as
 * non-symlink dirents). Escapes and sensitive targets throw ACCESS_DENIED and
 * skippable errors filter the entry; anything else is fatal. The accepted
 * TOCTOU window is documented on PathGuard.
 */
async function isEntryAccessible(guard: PathGuard, entryPath: string): Promise<boolean> {
  try {
    const { requestedPath, resolvedPath } = await guard.validateExistingPathDetailed(entryPath);
    return !guard.isSensitive(requestedPath) && !guard.isSensitive(resolvedPath);
  } catch (error) {
    if (isFsError(error)) {
      if (SKIPPABLE_FS_CODES.has(error.code)) return false;
      throw error;
    }
    if (isSkippableErrno(error)) return false;
    throw error;
  }
}

async function collect(rootPath: string, options: CollectOptions): Promise<CollectResult> {
  const entries: CollectedEntry[] = [];
  let scanned = 0;
  let totalEntries = 0;
  let totalFiles = 0;
  let totalDirectories = 0;
  const ceiling = options.pathGuard.allowedRootContaining(rootPath);

  for await (const entry of globEntries({
    cwd: rootPath,
    pattern: '**/*',
    skipIgnored: !options.includeIgnored,
    ...(ceiling !== undefined ? { ignoreCeiling: ceiling } : {}),
    signal: options.signal,
    includeHidden: options.includeHidden,
    baseNameMatch: false,
    // ListInputSchema.maxDepth is 1-based (1 = top-level only); the shared
    // globEntries primitive is now 0-based, so subtract one here. options.maxDepth
    // is guaranteed >= 1 by its PositiveInt schema, so this never underflows.
    maxDepth: options.maxDepth - 1,
    onlyFiles: false,
  })) {
    options.signal.throwIfAborted();
    scanned++;
    options.onProgress({ current: scanned });

    const entryType: EntryType = resolveEntryType(entry.dirent);
    const relPath = toPosixRelative(rootPath, entry.path);
    const name = basename(relPath);

    const accessible = await isEntryAccessible(options.pathGuard, entry.path);
    if (!accessible) continue;

    totalEntries++;
    if (entryType === 'directory') {
      totalDirectories++;
    } else {
      totalFiles++;
    }

    const collectedEntry: CollectedEntry = {
      name,
      relativePath: relPath,
      type: entryType,
    };

    if (entries.length < options.entryCap) {
      entries.push(collectedEntry);
    }
  }

  options.signal.throwIfAborted();
  entries.sort(compareEntries);

  return {
    entries,
    totalEntries,
    totalFiles,
    totalDirectories,
  };
}

const TEE = '├── ';
const ELBOW = '└── ';
const PIPE = '│   ';
const INDENT = '    ';

/**
 * The tree's first line names the listed folder the way the caller passes it
 * back: `src/core`, not `core`, which would name `<root>/core`. A root keeps
 * its own name.
 */
function treeHeader(pathGuard: PathGuard, dir: string): string {
  const paths = pathGuard.resultPaths(dir);
  return paths.atRoot ? basename(paths.root) : paths.show(dir);
}

function renderMarkdown(rootName: string, page: readonly CollectedEntry[]): string {
  if (page.length === 0) return rootName;

  // The tree is drawn down from the root, but a later page (or a capped set)
  // can hold entries whose ancestors sat elsewhere; those would never be drawn.
  // Re-draw each missing ancestor as context so every entry stays locatable.
  const present = new Set(page.map((entry) => entry.relativePath));
  const entries = [...page];
  for (const entry of page) {
    for (
      let dir = posix.dirname(entry.relativePath);
      dir !== '.' && !present.has(dir);
      dir = posix.dirname(dir)
    ) {
      present.add(dir);
      entries.push({ name: posix.basename(dir), relativePath: dir, type: 'directory' });
    }
  }
  entries.sort(compareEntries);

  // Group entries by parent path
  const childrenOf = new Map<string, CollectedEntry[]>();
  for (const entry of entries) {
    const slash = entry.relativePath.lastIndexOf('/');
    const parentKey = slash === -1 ? '' : entry.relativePath.slice(0, slash);
    if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
    const children = childrenOf.get(parentKey);
    if (children) children.push(entry);
  }

  const lines: string[] = [rootName];

  function renderChildren(parentKey: string, prefix: string): void {
    const children = childrenOf.get(parentKey);
    if (!children) return;

    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (!child) continue;
      const isLast = i === children.length - 1;
      const connector = isLast ? ELBOW : TEE;
      lines.push(prefix + connector + child.name + (child.type === 'directory' ? '/' : ''));

      const childKey = child.relativePath;
      const nextPrefix = prefix + (isLast ? INDENT : PIPE);
      renderChildren(childKey, nextPrefix);
    }
  }

  renderChildren('', '');
  return lines.join('\n');
}

const DEFAULT_LIST_DEPTH = 1;

const ListInputSchema = z.strictObject({
  path: OptionalPath.describe('Directory to list (default: first allowed root)'),
  maxDepth: PositiveInt.max(MAX_TREE_DEPTH)
    .default(DEFAULT_LIST_DEPTH)
    .describe(
      `Max directory depth to traverse (default: ${String(DEFAULT_LIST_DEPTH)} = top-level only; increase to recurse deeper)`,
    ),
  maxEntries: PositiveInt.max(MAX_LIST_ENTRIES)
    .default(DEFAULT_TREE_ENTRIES)
    .describe(
      `Page size (default: ${String(DEFAULT_TREE_ENTRIES)}). Continue with nextCursor; an incomplete first page also carries resourceUri for the whole list.`,
    ),
  includeHidden: IncludeHidden,
  includeIgnored: IncludeIgnored,
  cursor: CursorSchema,
});

interface ListPageMetadata {
  readonly path: string;
  readonly totalEntries: number;
  readonly totalFiles: number;
  readonly totalDirectories: number;
}

type ListOutput = ListPageMetadata & {
  entries: CollectedEntry[];
  entryCount: number;
  resourceUri?: string;
  nextCursor?: string;
};

export const LIST = defineTool<typeof ListInputSchema, ListOutput>({
  name: 'list',
  title: 'List',
  description:
    "List a directory's files and subdirectories as a tree of names, like ls or tree. " +
    'stat returns sizes and dates.',
  input: ListInputSchema,
  readOnlyHint: true,
  deadline: true,
  defaultErrorCode: ErrorCode.NOT_DIRECTORY,
  progress: (args) => ({
    label: 'List',
    subject: args.path ? basename(args.path) : '.',
  }),
  mapPaths: mapOptionalPath,
  run: async (args, ctx) => {
    const resolvedPath = ctx.fs.pathGuard.resolvePathOrRoot(args.path);
    const paged = await paginate<CollectedEntry, ListPageMetadata, JsonResourceResult>({
      store: ctx.pageStore,
      queryKey: pageQueryKey('list', { ...args, path: resolvedPath }, ['cursor', 'maxEntries']),
      cursor: args.cursor,
      pageSize: args.maxEntries,
      produce: async () => {
        const validDir = await ctx.fs.pathGuard.validateExistingDirectory(resolvedPath);
        const result = await collect(validDir, {
          maxDepth: args.maxDepth,
          includeHidden: args.includeHidden,
          includeIgnored: args.includeIgnored,
          signal: ctx.signal,
          pathGuard: ctx.fs.pathGuard,
          entryCap: MAX_LIST_ENTRIES,
          onProgress: ctx.onProgress,
        });
        return {
          items: result.entries,
          metadata: {
            path: validDir,
            totalEntries: result.totalEntries,
            totalFiles: result.totalFiles,
            totalDirectories: result.totalDirectories,
          },
          truncated: result.totalEntries > result.entries.length,
        };
      },
      externalize: (entries, metadata) => {
        const name = basename(metadata.path);
        // The stored tree is the whole collected set, bounded by the hard cap.
        const fullOutput = {
          entries,
          markdown: renderMarkdown(treeHeader(ctx.fs.pathGuard, metadata.path), entries),
          totalEntries: metadata.totalEntries,
          totalFiles: metadata.totalFiles,
          totalDirectories: metadata.totalDirectories,
          ...(metadata.totalEntries > entries.length ? { truncated: true } : {}),
        };
        return putJsonResource(ctx.resourceStore, `${name} tree`, fullOutput);
      },
    });

    const structured: ListOutput = {
      ...paged.metadata,
      entries: [...paged.page],
      entryCount: paged.page.length,
      ...(paged.resource ? { resourceUri: paged.resource.entry.uri } : {}),
      ...(paged.nextCursor !== undefined ? { nextCursor: paged.nextCursor } : {}),
    };
    // The tree is what the model reads, so position and the full-list URI ride
    // the text too — paging needs no second lookup. `pageTrailer` is the one
    // owner of that line, and it owes it on the last page as much as the first.
    const text =
      renderMarkdown(treeHeader(ctx.fs.pathGuard, paged.metadata.path), [...paged.page]) +
      pageTrailer({
        offset: paged.offset,
        shown: structured.entryCount,
        total: structured.totalEntries,
        noun: 'entries',
        tool: 'list',
        nextCursor: structured.nextCursor,
        nextArgs: args,
      }) +
      (structured.resourceUri !== undefined ? `\nfull tree at ${structured.resourceUri}` : '');
    return {
      structured,
      text,
      ...(paged.resource ? { resources: [paged.resource.link] } : {}),
    };
  },
});
