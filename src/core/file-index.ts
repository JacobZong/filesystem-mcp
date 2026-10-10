import { mkdir, opendir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// SIMPLIFIED: a list of file paths under the allowed roots, kept in memory,
// saved gzipped to FS_INDEX_DIR (when set) and rebuilt by a full rescan once a
// day at FS_INDEX_REBUILD_HOUR (local time, default 4). Paths only (one readdir
// per folder, no stat): ~300k files take a few minutes over SMB and ~70 MB of
// memory. size/mtime are read per hit at query time, through the PathGuard.
// Upgrade to incremental updates (watchers or mtime diffs) if a nightly full
// rescan becomes too slow.
const MAX_FILES = 2_000_000;
const INDEX_FILE = 'filename-index-v1.json.gz';
const STALE_MS = 26 * 60 * 60 * 1000; // a missed nightly run still triggers a rebuild

interface IndexState {
  roots: string[];
  files: string[];
  builtAt?: number | undefined;
  building?: Promise<void> | undefined;
  scanned: number;
  truncated: boolean;
  loadedFromDisk: boolean;
  error?: string | undefined;
}

interface SavedIndex {
  version: 1;
  roots: string[];
  builtAt: number;
  truncated: boolean;
  files: string[];
}

function emptyState(): IndexState {
  return { roots: [], files: [], scanned: 0, truncated: false, loadedFromDisk: false };
}

let state: IndexState = emptyState();
let scheduler: NodeJS.Timeout | undefined;

function indexDir(): string | undefined {
  const dir = process.env['FS_INDEX_DIR'];
  return dir && dir.length > 0 ? dir : undefined;
}

function sameRoots(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i]);
}

/** Hidden, system (@eaDir, @Recycle) and recycle-bin (#recycle) folders are not indexed. */
function skipDir(name: string): boolean {
  return name.startsWith('.') || name.startsWith('@') || name.startsWith('#');
}

async function scan(roots: readonly string[]): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
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
          if (files.length >= MAX_FILES) return { files, truncated: true };
          files.push(full);
          state.scanned = files.length;
        }
      }
    } catch {
      // A folder that fails mid-listing keeps what was read.
    }
  }
  return { files, truncated: false };
}

async function save(saved: SavedIndex): Promise<void> {
  const dir = indexDir();
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  const target = join(dir, INDEX_FILE);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, await gzipAsync(JSON.stringify(saved)));
  await rename(tmp, target); // atomic: a crash never leaves a half-written index
}

/** Loads the saved index when it was built for the same roots. */
async function load(roots: readonly string[]): Promise<boolean> {
  const dir = indexDir();
  if (!dir) return false;
  try {
    const raw = await gunzipAsync(await readFile(join(dir, INDEX_FILE)));
    const saved = JSON.parse(raw.toString('utf8')) as Partial<SavedIndex>;
    if (
      saved.version !== 1 ||
      typeof saved.builtAt !== 'number' ||
      !Array.isArray(saved.roots) ||
      !sameRoots(saved.roots, roots) ||
      !Array.isArray(saved.files)
    ) {
      return false;
    }
    state = {
      roots: [...roots],
      files: saved.files,
      builtAt: saved.builtAt,
      scanned: saved.files.length,
      truncated: saved.truncated === true,
      loadedFromDisk: true,
    };
    return true;
  } catch {
    return false; // no index yet, or unreadable: rebuild
  }
}

/** Full rescan; the previous index keeps answering until the new one is swapped in. */
function rebuild(roots: readonly string[]): Promise<void> {
  if (state.building) return state.building;
  const target = [...roots];
  if (!sameRoots(state.roots, target)) state = { ...emptyState(), roots: target };
  const building = scan(target)
    .then(async ({ files, truncated }) => {
      const builtAt = Date.now();
      state = {
        roots: target,
        files,
        builtAt,
        scanned: files.length,
        truncated,
        loadedFromDisk: false,
      };
      await save({ version: 1, roots: target, builtAt, truncated, files }).catch(
        (error: unknown) => {
          state.error = `index not saved: ${String(error)}`;
        },
      );
    })
    .catch((error: unknown) => {
      state.error = String(error);
    })
    .finally(() => {
      state.building = undefined;
    });
  state.building = building;
  return building;
}

/**
 * Makes sure an index exists for these roots: loads the saved one, or starts a
 * rebuild when there is none, the roots changed, or it is older than a day.
 * Resolves when the index is ready to answer (possibly the previous one).
 */
export async function ensureIndex(roots: readonly string[]): Promise<void> {
  if (!sameRoots(state.roots, roots) || state.builtAt === undefined) {
    if (state.building && sameRoots(state.roots, roots)) return state.building;
    if (await load(roots)) {
      if (Date.now() - (state.builtAt ?? 0) > STALE_MS) void rebuild(roots);
      return;
    }
    return rebuild(roots);
  }
  if (Date.now() - state.builtAt > STALE_MS) void rebuild(roots);
}

function msUntilNextRun(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Starts once per process when FS_INDEX_DIR is set (deployments): load or
 * build the index now, then rebuild it every day at FS_INDEX_REBUILD_HOUR local
 * time. Without FS_INDEX_DIR, locate builds the index on first use only.
 * Safe to call on every registration.
 */
export function startIndexScheduler(getRoots: () => readonly string[]): void {
  if (scheduler || !indexDir() || process.env['FS_INDEX_DISABLED'] === '1') return;
  const parsed = Number.parseInt(process.env['FS_INDEX_REBUILD_HOUR'] ?? '4', 10);
  const hour = Number.isInteger(parsed) ? Math.min(23, Math.max(0, parsed)) : 4;
  const tick = (): void => {
    let roots: readonly string[] = [];
    try {
      roots = getRoots();
    } catch {
      // roots not configured yet: try again tomorrow
    }
    if (roots.length > 0) void rebuild(roots);
    scheduler = setTimeout(tick, msUntilNextRun(hour));
    scheduler.unref();
  };
  try {
    const roots = getRoots();
    if (roots.length > 0) void ensureIndex(roots);
  } catch {
    // roots not configured yet; locate builds on first use
  }
  scheduler = setTimeout(tick, msUntilNextRun(hour));
  scheduler.unref();
}

export interface IndexStatus {
  ready: boolean;
  files: number;
  scanned: number;
  builtAt?: number;
  building: boolean;
  truncated: boolean;
  loadedFromDisk: boolean;
  error?: string;
}

export function indexStatus(): IndexStatus {
  return {
    ready: state.builtAt !== undefined,
    files: state.files.length,
    scanned: state.scanned,
    ...(state.builtAt !== undefined ? { builtAt: state.builtAt } : {}),
    building: state.building !== undefined,
    truncated: state.truncated,
    loadedFromDisk: state.loadedFromDisk,
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
  for (const file of state.files) {
    const lowerPath = file.toLowerCase();
    if (!lowered.every((t) => lowerPath.includes(t))) continue;
    if (exts.size > 0 && !exts.has(extname(file).toLowerCase())) continue;
    const lowerName = basename(lowerPath);
    hits.push({ path: file, byName: lowered.every((t) => lowerName.includes(t)) });
  }
  hits.sort((a, b) => Number(b.byName) - Number(a.byName) || a.path.length - b.path.length);
  return hits.slice(0, max).map((h) => h.path);
}

/** Test hook: forget the current index and stop the scheduler. */
export function resetIndexForTests(): void {
  if (scheduler) clearTimeout(scheduler);
  scheduler = undefined;
  state = emptyState();
}
