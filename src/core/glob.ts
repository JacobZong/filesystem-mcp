import { glob as fsGlob, readFile as fsReadFile, lstat } from 'node:fs/promises';
import { basename, dirname, join, matchesGlob, relative, resolve, win32 } from 'node:path';

import type { Ignore } from 'ignore';
import ignore from 'ignore';

import { processInParallel } from './concurrency.ts';
import { formatUnknownErrorMessage } from './errors.ts';
import { Logger } from './observability.ts';
import type { DirentLike } from './path-utils.ts';
import { isPathInsideDirectory, toPosixPath } from './path-utils.ts';
import { MIB } from './util.ts';

/**
 * More brace alternatives than this is not a file filter. fs.glob's matcher
 * dedupes its alternatives pairwise, synchronously: `{1..100000}` pins the
 * event loop for most of a minute, where 1024 costs tens of milliseconds.
 */
const MAX_BRACE_ALTERNATIVES = 1024;

// The range bodies fs.glob's brace expansion recognises, as it writes them.
const NUMERIC_RANGE_RE = /^-?\d+\.\.-?\d+(?:\.\.-?\d+)?$/u;
const ALPHA_RANGE_RE = /^[a-zA-Z]\.\.[a-zA-Z](?:\.\.-?\d+)?$/u;

/** The values a range body (`x..y`, `x..y..step`) expands to, or `undefined` past the cap. */
function rangeValues(body: string): string[] | undefined {
  const alpha = ALPHA_RANGE_RE.test(body);
  const [from = '', to = '', step = '1'] = body.split('..');
  const bound = (end: string): number => (alpha ? end.charCodeAt(0) : Number.parseInt(end, 10));
  const start = bound(from);
  const stop = bound(to);
  const stride = Math.max(Math.abs(Number.parseInt(step, 10)), 1);
  // A bound past Number.MAX_VALUE reads as Infinity, which the engine counts
  // up from forever (to its own cap): refuse it like any other long range.
  if (!Number.isFinite(start) || !Number.isFinite(stop)) return undefined;
  if (Math.floor(Math.abs(stop - start) / stride) >= MAX_BRACE_ALTERNATIVES) return undefined;
  const values: string[] = [];
  const direction = stop < start ? -1 : 1;
  for (let i = start; (stop - i) * direction >= 0; i += stride * direction) {
    // The engine drops a `\` a letter range passes through (`{Z..a}`), and
    // digits can never spell a root or a `..`, so their padding is moot.
    const char = String.fromCharCode(i);
    values.push(alpha ? (char === '\\' ? '' : char) : String(i));
  }
  return values;
}

interface BraceSet {
  pre: string;
  /** `undefined` when the set alone expands past the cap. */
  alternatives: string[] | undefined;
  post: string;
}

/**
 * The leftmost `{…}` that fs.glob would expand: a comma list or a range.
 * The expansion is textual, as fs.glob's is: a brace inside `[…]` still
 * counts (unlike SensitiveMatcher's own glob dialect in sensitive.ts).
 */
function firstBraceSet(pattern: string): BraceSet | undefined {
  const open: { at: number; commas: number[] }[] = [];
  let first: { at: number; commas: number[]; close: number } | undefined;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '{') open.push({ at: i, commas: [] });
    else if (char === ',') open.at(-1)?.commas.push(i);
    else if (char === '}') {
      const set = open.pop();
      if (!set || (first && first.at < set.at)) continue;
      const body = pattern.slice(set.at + 1, i);
      if (set.commas.length > 0 || NUMERIC_RANGE_RE.test(body) || ALPHA_RANGE_RE.test(body)) {
        first = { ...set, close: i };
      }
    }
  }
  if (!first) return undefined;
  let alternatives: string[] | undefined;
  if (first.commas.length > 0) {
    alternatives = [];
    let start = first.at + 1;
    for (const end of [...first.commas, first.close]) {
      alternatives.push(pattern.slice(start, end));
      start = end + 1;
    }
  } else {
    alternatives = rangeValues(pattern.slice(first.at + 1, first.close));
  }
  return { pre: pattern.slice(0, first.at), alternatives, post: pattern.slice(first.close + 1) };
}

/** Every brace alternative of `pattern`, or `undefined` past the cap. */
function expandBraceSets(pattern: string, out: string[] = []): string[] | undefined {
  const set = firstBraceSet(pattern);
  if (!set) {
    out.push(pattern);
    return out.length > MAX_BRACE_ALTERNATIVES ? undefined : out;
  }
  if (!set.alternatives) return undefined;
  for (const alternative of set.alternatives) {
    if (!expandBraceSets(`${set.pre}${alternative}${set.post}`, out)) return undefined;
  }
  return out;
}

/**
 * Whether the glob engine reads this brace-free segment as `..`. Asks the
 * engine itself, so a single-character class (`[.]`, `[.-.]`) is caught as it
 * would be walked. A segment with no `.` cannot: readdir never yields `..`, so
 * only a literal reaches it.
 */
const isTraversalSegment = (segment: string): boolean =>
  segment.includes('.') && matchesGlob('..', segment);

/** An alternative that starts at a root: `/x`, `//host/share`, `C:/x`, `C:x`. */
const isRooted = (alternative: string): boolean =>
  win32.parse(alternative).root !== '' || (alternative.split('/')[0] ?? '').endsWith(':');

export function isSafeGlobSyntax(pattern: string): boolean {
  if (!pattern || pattern.trim().length === 0) {
    return false;
  }
  // The walk sees the pattern with `\` as `/` (normalizePattern), so check
  // that form: `\etc\x` is `/etc/x` there, an absolute walk on any host.
  // Brace sets can build a root or a `..` from parts (`{/etc,x}`, `..{,x}`,
  // `.{Z..a}.`), so check every alternative, not the pattern as written.
  // globEntries still drops any match outside its cwd: this check is what
  // turns such a pattern into an error rather than a quietly narrower walk.
  const alternatives = expandBraceSets(toPosixPath(pattern));
  if (!alternatives) return false;
  const segments = new Set<string>();
  for (const alternative of alternatives) {
    if (isRooted(alternative)) return false;
    for (const segment of alternative.split('/')) segments.add(segment);
  }
  for (const segment of segments) {
    if (isTraversalSegment(segment)) return false;
  }
  return true;
}

/** A .gitignore past this size is not a .gitignore; skip it rather than read it. */
const MAX_GITIGNORE_BYTES = MIB;

async function loadGitignoreFiles(
  root: string,
  gitignorePaths: readonly string[],
  manager: GitignoreManager,
  signal?: AbortSignal,
): Promise<void> {
  await processInParallel(
    gitignorePaths,
    async (relPath) => {
      const absPath = join(root, relPath);
      try {
        // lstat, not stat: a symlinked .gitignore may point at a device, a
        // FIFO or a huge file outside the root. Only a plain, small file is a
        // rule set worth reading.
        const info = await lstat(absPath);
        if (!info.isFile() || info.size > MAX_GITIGNORE_BYTES) return;
        const contents = await fsReadFile(absPath, { encoding: 'utf-8', signal });
        const matcher = ignore();
        matcher.add(contents);
        const dir = toPosixPath(dirname(relPath));
        manager.addMatcher(dir === '.' ? '' : dir, matcher);
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') throw error;
        Logger.warn(`Failed to read .gitignore at ${absPath}: ${formatUnknownErrorMessage(error)}`);
      }
    },
    GLOB_BATCH_CONCURRENCY,
    signal,
  );
}

/**
 * Load `.gitignore` from each ancestor of `root` up to and including `ceiling`,
 * farthest first. A rule set that ignores `root` itself is skipped: the caller
 * named that directory on purpose, and applying the rule would empty the walk.
 */
async function loadAncestorGitignores(
  root: string,
  ceiling: string,
  manager: GitignoreManager,
  signal?: AbortSignal,
): Promise<void> {
  const normalizedCeiling = resolve(ceiling);
  const chain: string[] = [];
  for (let dir = dirname(resolve(root)); ; dir = dirname(dir)) {
    if (!isPathInsideDirectory(normalizedCeiling, dir)) break;
    chain.push(dir);
    if (
      (isPathInsideDirectory(dir, normalizedCeiling) &&
        isPathInsideDirectory(normalizedCeiling, dir)) ||
      dirname(dir) === dir
    ) {
      break;
    }
  }
  for (const dir of chain.reverse()) {
    signal?.throwIfAborted();
    const file = join(dir, '.gitignore');
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.size > MAX_GITIGNORE_BYTES) continue;
      const matcher = ignore().add(await fsReadFile(file, { encoding: 'utf-8', signal }));
      const prefix = toPosixPath(relative(dir, root));
      if (matcher.test(`${prefix}/`).ignored) continue;
      manager.addAncestorMatcher(prefix, matcher);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      // ENOENT is the normal case (no .gitignore at this level); anything else is not worth a warning per walk
    }
  }
}

class GitignoreManager {
  private matchers = new Map<string, Ignore>();
  /** Rules from directories above the walk root, farthest first; `prefix` re-bases a walk-relative path to that directory. */
  private ancestors: { prefix: string; matcher: Ignore }[] = [];

  addMatcher(dir: string, matcher: Ignore): void {
    this.matchers.set(dir, matcher);
  }

  addAncestorMatcher(prefix: string, matcher: Ignore): void {
    this.ancestors.push({ prefix, matcher });
  }

  /** `null` when no `.gitignore` was found, so callers skip the filter entirely. */
  static async load(
    root: string,
    includeHidden: boolean,
    signal?: AbortSignal,
    maxDepth?: number,
    ignoreCeiling?: string,
  ): Promise<GitignoreManager | null> {
    const manager = new GitignoreManager();
    try {
      const gitignorePaths: string[] = [];
      // Search dot-directories (.venv, .terraform, ...) for rules only when the
      // walk includes hidden entries; for any other walk, enumerating every
      // hidden tree would cost more than the walk itself.
      const gitignorePatterns = includeHidden
        ? [...buildHiddenPatterns('**/.gitignore')]
        : ['**/.gitignore'];
      const gitignoreEntries = fsGlob(gitignorePatterns, {
        cwd: root,
        // Skip what the walk itself skips, and stop one level past its depth
        // bound: a .gitignore at depth d only affects entries at depth >= d.
        exclude: (entry: string) => {
          if (signal?.aborted) return true;
          const name = basename(entry);
          if (name === '.hg' || name === '.svn' || DEFAULT_EXCLUDED_NAMES.has(name)) return true;
          return maxDepth !== undefined && toPosixPath(entry).split('/').length - 1 > maxDepth;
        },
      });
      for await (const match of gitignoreEntries) {
        if (signal?.aborted) break;
        gitignorePaths.push(match);
      }

      await loadGitignoreFiles(root, gitignorePaths, manager, signal);
      if (ignoreCeiling !== undefined) {
        await loadAncestorGitignores(root, ignoreCeiling, manager, signal);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      Logger.warn(
        `Failed to enumerate .gitignore files under ${root}: ${formatUnknownErrorMessage(error)}`,
      );
    }
    return manager.matchers.size === 0 && manager.ancestors.length === 0 ? null : manager;
  }

  isIgnored(relativePath: string, isDirectory: boolean): boolean {
    const normalized = toPosixPath(relativePath);
    if (normalized === '' || normalized === '.') return false;
    const parts = normalized.split('/');

    // 1. Check parent directories first
    let currentDir = '';
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) continue;
      currentDir = currentDir ? `${currentDir}/${part}` : part;

      if (this.checkPath(currentDir, true)) {
        return true;
      }
    }

    // 2. Check the file/directory itself
    return this.checkPath(normalized, isDirectory);
  }

  private checkPath(posixPath: string, isDirectory: boolean): boolean {
    const parts = posixPath.split('/');
    const pathToCheck = isDirectory
      ? posixPath.endsWith('/')
        ? posixPath
        : `${posixPath}/`
      : posixPath;

    let ignored = false;

    for (const { prefix, matcher } of this.ancestors) {
      const res = matcher.test(`${prefix}/${pathToCheck}`);
      if (res.ignored) ignored = true;
      if (res.unignored) ignored = false;
    }

    // Check root level
    const rootMatcher = this.matchers.get('');
    if (rootMatcher) {
      const res = rootMatcher.test(pathToCheck);
      if (res.ignored) ignored = true;
      if (res.unignored) ignored = false;
    }

    // Check subdirectories
    let currentDir = '';
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!part) continue;
      currentDir = currentDir ? `${currentDir}/${part}` : part;

      const matcher = this.matchers.get(currentDir);
      if (matcher) {
        const relParts = parts.slice(i + 1);
        const relPath = relParts.join('/');
        const relPathToCheck = isDirectory
          ? relPath.endsWith('/')
            ? relPath
            : `${relPath}/`
          : relPath;

        const res = matcher.test(relPathToCheck);
        if (res.ignored) ignored = true;
        if (res.unignored) ignored = false;
      }
    }

    return ignored;
  }
}

interface GlobDirentLike extends DirentLike {
  name: string;
  parentPath: string;
}

export interface GlobEntry {
  path: string;
  dirent: DirentLike;
}

export interface GlobEntriesOptions {
  cwd: string;
  pattern: string;
  includeHidden?: boolean;
  baseNameMatch?: boolean;
  maxDepth?: number;
  onlyFiles?: boolean;
  suppressErrors?: boolean;
  /** Skip what a walk should not surface: DEFAULT_EXCLUDED_NAMES and .gitignore. */
  skipIgnored?: boolean;
  /**
   * Topmost directory whose `.gitignore` may apply to this walk — the allowed
   * root containing `cwd`. Ancestors of `cwd` up to and including it are
   * consulted; nothing above it is ever read. Ignored without `skipIgnored`.
   */
  ignoreCeiling?: string;
  /** Bounds the `.gitignore` discovery `skipIgnored` runs before the walk. */
  signal?: AbortSignal;
}

interface NormalizedGlob {
  cwd: string;
  patterns: readonly string[];
  suppressErrors: boolean;
  maxDepth?: number;
}

const GLOB_MAGIC_RE = /[*?[\]{}!]/u;
const GLOB_BATCH_CONCURRENCY = 64;
const SEP = '/';
function normalizePattern(pattern: string, baseNameMatch: boolean): string {
  const normalized = toPosixPath(pattern);

  if (!baseNameMatch) return normalized;
  if (normalized.includes(SEP)) return normalized;
  return `**/${normalized}`;
}

function splitPatternPrefix(normalizedPattern: string): {
  prefix: string;
  remainder: string;
} {
  if (!GLOB_MAGIC_RE.test(normalizedPattern)) {
    return { prefix: '', remainder: normalizedPattern };
  }

  const segments = normalizedPattern.split(SEP);
  const splitIndex = segments.findIndex((seg) => GLOB_MAGIC_RE.test(seg));

  if (splitIndex <= 0) {
    return { prefix: '', remainder: normalizedPattern };
  }

  return {
    prefix: segments.slice(0, splitIndex).join(SEP) + SEP,
    remainder: segments.slice(splitIndex).join(SEP),
  };
}

/**
 * The segment matching the dot-prefixed names `segment` would match if fs.glob
 * did not skip them, or `undefined` when there are none. Only a leading `*` or
 * `?` stands for that dot: a literal never does, and a character class or a
 * brace set is left as written rather than parsed.
 */
function dotVariant(segment: string): string | undefined {
  // `*(…)` and `?(…)` are extglobs, not wildcards.
  if (segment[1] === '(') return undefined;
  if (segment.startsWith('*')) return `.${segment}`;
  if (!segment.startsWith('?')) return undefined;
  // `?` is exactly one character, so the dot replaces it, unless what follows
  // could leave just `.` or `..` (`?`, `?.`, `?{.,x}`, `?[.]`): the directory
  // and its parent, not a dot-prefixed entry.
  const rest = segment.slice(1);
  return rest === '' || /^[.[{]/u.test(rest) ? undefined : `.${rest}`;
}

function addFirstDotSegment(patterns: Set<string>, prefix: string, remainder: string): void {
  if (remainder.length === 0) return;
  const segments = remainder.split(SEP);
  const idx = segments.findIndex((seg) => seg !== '**' && seg.length > 0);

  if (idx !== -1) {
    const original = segments[idx];
    const dotted = original ? dotVariant(original) : undefined;
    if (dotted) {
      const newSegments = [...segments];
      newSegments[idx] = dotted;
      patterns.add(`${prefix}${newSegments.join(SEP)}`);
    }
  }
}

function expandHiddenGlobstars(patterns: Set<string>, prefix: string, remainder: string): void {
  // Trailing bare globstar — `src/**`, `**` (remainder is exactly `**`, no
  // following segment). The pattern itself already matches every non-dot
  // entry under the prefix; add the two hidden complements fs.glob skips:
  // dotfiles/dot-dirs anywhere, and the contents of dot-dirs anywhere.
  if (remainder === '**') {
    patterns.add(`${prefix}**/.*`);
    patterns.add(`${prefix}**/.*/**`);
    return;
  }

  if (!remainder.startsWith('**/')) return;

  const afterGlobstar = remainder.slice(3);
  // Node fs.glob skips leading-dot entries unless the matching segment itself
  // starts with '.', and its `dot` option is not honored. So `**/*` alone misses
  // hidden files. Two depth-agnostic patterns cover everything the per-depth
  // unroll did: contents of dot-directories anywhere, and dotfiles/dotdirs
  // anywhere (when the first segment after the globstar can match a dot).
  patterns.add(`${prefix}**/.*/**/${afterGlobstar}`);
  const [firstSegment = '', ...rest] = afterGlobstar.split(SEP);
  const dotted = dotVariant(firstSegment);
  if (dotted) patterns.add(`${prefix}**/${[dotted, ...rest].join(SEP)}`);
}

function buildHiddenPatterns(normalizedPattern: string): readonly string[] {
  const patterns = new Set<string>([normalizedPattern]);
  const { prefix, remainder } = splitPatternPrefix(normalizedPattern);

  addFirstDotSegment(patterns, prefix, remainder);
  expandHiddenGlobstars(patterns, prefix, remainder);

  return Array.from(patterns);
}

function normalizeGlobOptions(options: GlobEntriesOptions): NormalizedGlob {
  const cwd = resolve(options.cwd);
  const normalizedPattern = normalizePattern(options.pattern, options.baseNameMatch ?? false);

  const patterns = options.includeHidden
    ? buildHiddenPatterns(normalizedPattern)
    : [normalizedPattern];

  const normalized: NormalizedGlob = {
    cwd,
    patterns,
    suppressErrors: options.suppressErrors ?? false,
  };

  if (options.maxDepth !== undefined) {
    normalized.maxDepth = options.maxDepth;
  }

  return normalized;
}

function* processDirentMatch(
  match: GlobDirentLike,
  cwd: string,
  maxDepth: number | undefined,
  seen: Set<string>,
  onlyFiles: boolean,
): Generator<GlobEntry> {
  const absolutePath = resolve(cwd, match.parentPath, match.name);
  // The walk's scope is its cwd, whatever the pattern spells: a `..` or a root
  // the validator did not foresee must not reach a caller, where it would be
  // read, rewritten, or counted and named as inaccessible.
  if (!isPathInsideDirectory(cwd, absolutePath)) return;

  if (maxDepth !== undefined) {
    const rel = relative(cwd, absolutePath);
    if (rel.split(/[/\\]/u).length - 1 > maxDepth) return;
  }

  if (seen.has(absolutePath)) return;
  seen.add(absolutePath);

  if (onlyFiles && !match.isFile()) return;
  yield { path: absolutePath, dirent: match };
}

interface WalkFilter {
  /** Given to fs.glob: true stops descent into a directory. */
  prune: (match: GlobDirentLike) => boolean;
  /** Re-applied to yielded entries: the ignore rules only, never the depth bound. */
  isExcluded: (match: GlobDirentLike) => boolean;
}

function createWalkFilter(
  cwd: string,
  skipIgnored: boolean,
  gitignoreMatcher: GitignoreManager | null,
  maxDepth: number | undefined,
  signal: AbortSignal | undefined,
): WalkFilter {
  // fs.glob can hand the predicate a dirent whose parentPath is "." — the walk
  // root, not the process cwd — when it re-visits a directory under `**` whose
  // name also exists in the process cwd. Resolving against `cwd` names the
  // entry the dirent describes; `join` would resolve it against the process.
  const absoluteOf = (match: GlobDirentLike): string => resolve(cwd, match.parentPath, match.name);
  const relativeOf = (match: GlobDirentLike): string =>
    toPosixPath(relative(cwd, absoluteOf(match)));
  // Every default exclude is a bare name that applies at any depth, so a Set
  // lookup per segment replaces compiling dozens of globs per entry.
  const excluded = (posixRel: string, isDir: boolean): boolean =>
    skipIgnored &&
    (posixRel.split('/').some((segment) => DEFAULT_EXCLUDED_NAMES.has(segment)) ||
      (gitignoreMatcher?.isIgnored(posixRel, isDir) ?? false));

  return {
    prune: (match) => {
      // fs.glob takes no signal and calls this for every entry it visits, so
      // pruning everything is the only way to stop a walk that yields nothing.
      if (signal?.aborted) return true;
      // fs.glob asks before it queues a directory, so a walk that would
      // climb to `../` or start at `/` stops at the edge instead of reading
      // there. Not every climb asks (`**/..` does not): processDirentMatch is
      // the gate, this only saves the walk.
      if (!isPathInsideDirectory(cwd, absoluteOf(match))) return true;
      const posixRel = relativeOf(match);
      const isDir = match.isDirectory();
      if (excluded(posixRel, isDir)) return true;
      // Stop descent one level past the depth bound. Pruning a directory *at*
      // the bound would drop it where fs.glob treats it as top-level, so prune
      // its children instead; processDirentMatch drops that extra level.
      if (maxDepth === undefined || !isDir) return false;
      return posixRel.split('/').length - 1 > maxDepth;
    },
    isExcluded: (match) => excluded(relativeOf(match), match.isDirectory()),
  };
}

async function* processGlobPattern(
  pattern: string,
  plan: NormalizedGlob,
  seen: Set<string>,
  onlyFiles: boolean,
  filter: WalkFilter,
  signal: AbortSignal | undefined,
): AsyncGenerator<GlobEntry> {
  const { cwd, maxDepth, suppressErrors } = plan;
  let iterable: AsyncIterable<GlobDirentLike>;
  try {
    iterable = fsGlob(pattern, {
      cwd,
      exclude: filter.prune,
      withFileTypes: true,
    }) as AsyncIterable<GlobDirentLike>;
  } catch (error) {
    if (suppressErrors) return;
    throw error;
  }

  try {
    for await (const match of iterable) {
      if (signal?.aborted) break;
      // A function `exclude` only prunes descent in fs.glob — it still yields
      // the rejected dirent itself, and any rejected entry below the top level.
      // Re-apply the ignore rules (not the depth bound) to drop those.
      if (filter.isExcluded(match)) continue;
      yield* processDirentMatch(match, cwd, maxDepth, seen, onlyFiles);
    }
  } catch (error) {
    if (!suppressErrors) throw error;
    Logger.warn(
      `globEntries: suppressed mid-walk error for pattern "${pattern}": ${formatUnknownErrorMessage(error)}`,
    );
  }
  // A pruned walk ends like a finished one. Say it was cut short, so no caller
  // reads "the walk ended" as "the whole tree was seen".
  signal?.throwIfAborted();
}

export async function* globEntries(options: GlobEntriesOptions): AsyncGenerator<GlobEntry> {
  const gitignoreMatcher = options.skipIgnored
    ? await GitignoreManager.load(
        options.cwd,
        options.includeHidden ?? false,
        options.signal,
        options.maxDepth,
        options.ignoreCeiling,
      )
    : null;

  const plan = normalizeGlobOptions(options);
  const seen = new Set<string>();
  const onlyFiles = options.onlyFiles ?? true;
  const filter = createWalkFilter(
    plan.cwd,
    options.skipIgnored ?? false,
    gitignoreMatcher,
    plan.maxDepth,
    options.signal,
  );

  for (const pattern of plan.patterns) {
    yield* processGlobPattern(pattern, plan, seen, onlyFiles, filter, options.signal);
  }
}

/** Names a `skipIgnored` walk never enters or yields, at any depth. */
const DEFAULT_EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.vscode',
  '.idea',
  '.DS_Store',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.cache',
  '.yarn',
  'jspm_packages',
  'bower_components',
  'out',
  'tmp',
  '.temp',
  'npm-debug.log',
  'yarn-debug.log',
  'yarn-error.log',
  'Thumbs.db',
]);
