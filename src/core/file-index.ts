import { opendir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

// SIMPLIFIED: an in-memory list of file paths under the allowed roots, rebuilt
// in the background at most once a day. Paths only (one readdir per folder, no
// stat), so a 150k-file library indexes in about a minute over SMB; size and
// mtime are read per hit at query time, through the PathGuard. Upgrade to a
// persisted, watcher-fed index if the library grows past a few million files.
const REFRESH_MS = 24 * 60 * 60 * 1000;
const MAX_FILES = 2_000_000;

interface IndexEntry {
  file: string;
  lowerName: string;
  lowerPath: string;
}

interface IndexState {
  roots: string[];
  entries: IndexEntry[];
  builtAt?: number | undefined;
  building?: Promise<void> | undefined;
  scanned: number;
  truncated: boolean;
  error?: string | undefined;
}

let state: IndexState = {
  roots: [],
  entries: [],
  scanned: 0,
  truncated: false,
};

/** Hidden, system (@eaDir, @Recycle) and recycle-bin (#recycle) folders are not indexed. */
function skipDir(name: string): boolean {
  return name.startsWith('.') || name.startsWith('@') || name.startsWith('#');
}

async function build(roots: string[]): Promise<void> {
  const files: string[] = [];
  let truncated = false;
  const stack = [...roots];
  for (;;) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let handle;
    try {
      handle = await opendir(dir);
    } catch {
      continue; // permission denied or vanished: index what is readable
    }
    try {
      for await (const entry of handle) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skipDir(entry.name)) stack.push(full);
        } else if (entry.isFile()) {
          if (files.length >= MAX_FILES) {
            truncated = true;
            break;
          }
          files.push(full);
          state.scanned = files.length;
        }
      }
    } catch {
      // A folder that fails mid-listing keeps what was read.
    }
    if (truncated) break;
  }
  state = {
    roots,
    entries: files.map((file) => ({
      file,
      lowerName: basename(file).toLowerCase(),
      lowerPath: file.toLowerCase(),
    })),
    builtAt: Date.now(),
    scanned: files.length,
    truncated,
  };
}

/** Starts a build when there is none, the roots changed, or the index is a day old. */
export function ensureIndex(roots: readonly string[]): Promise<void> {
  const sameRoots =
    roots.length === state.roots.length && roots.every((r, i) => r === state.roots[i]);
  const fresh = state.builtAt !== undefined && Date.now() - state.builtAt < REFRESH_MS;
  if (state.building) return state.building;
  if (sameRoots && fresh) return Promise.resolve();
  const target = [...roots];
  const keep = sameRoots ? state : { ...state, roots: target, entries: [], builtAt: undefined };
  const building = build(target)
    .catch((error: unknown) => {
      state = { ...keep, error: String(error) };
    })
    .finally(() => {
      state.building = undefined;
    });
  state = { ...keep, roots: target, building, scanned: 0 };
  return building;
}

export interface IndexStatus {
  ready: boolean;
  files: number;
  scanned: number;
  builtAt?: number;
  building: boolean;
  truncated: boolean;
  error?: string;
}

export function indexStatus(): IndexStatus {
  return {
    ready: state.builtAt !== undefined,
    files: state.entries.length,
    scanned: state.scanned,
    ...(state.builtAt !== undefined ? { builtAt: state.builtAt } : {}),
    building: state.building !== undefined,
    truncated: state.truncated,
    ...(state.error !== undefined ? { error: state.error } : {}),
  };
}

/**
 * Paths whose full path contains every term (case-insensitive), optionally
 * limited to extensions. Hits whose file name contains every term rank first,
 * then shorter paths.
 */
export function searchIndex(
  terms: readonly string[],
  exts: ReadonlySet<string>,
  max: number,
): string[] {
  const lowered = terms.map((t) => t.toLowerCase()).filter(Boolean);
  const hits: { path: string; byName: boolean }[] = [];
  for (const { file, lowerName, lowerPath } of state.entries) {
    if (!lowered.every((t) => lowerPath.includes(t))) continue;
    if (exts.size > 0 && !exts.has(extname(file).toLowerCase())) continue;
    hits.push({ path: file, byName: lowered.every((t) => lowerName.includes(t)) });
  }
  hits.sort((a, b) => Number(b.byName) - Number(a.byName) || a.path.length - b.path.length);
  return hits.slice(0, max).map((h) => h.path);
}

/** Test hook: forget the current index. */
export function resetIndexForTests(): void {
  state = { roots: [], entries: [], scanned: 0, truncated: false };
}
