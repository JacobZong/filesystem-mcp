# Plan: `list` gains opt-in sizes, sort-by-size, and a totals line (#99)

> **Executor rules**: work the steps in order. Run every Verify command and
> confirm its expected result before moving on. On any STOP condition, stop and
> report the condition, the step, and the evidence.
>
> **Written against** commit `8fffa76e`, 2026-10-15.
> **Drift check (run first)**: `git diff --stat 8fffa76e..HEAD -- src/tools/list.ts src/core/fmt.ts __tests__/tools.test.ts __tests__/contract.test.ts.snapshot docs/client-guide.md`
> Its file list is what narrows the excerpt match: compare
> [Current state](#current-state) against the live code for every file it flags.
> A mismatch is a [STOP](#stop) condition.

## Goal

`list` prints only names, so "what's taking up space here?" costs one `stat`
call per file (issue [#99](https://github.com/j0hanz/filesystem-mcp/issues/99)).
After this lands, `list` takes opt-in `includeSizes` (per-file size in the tree
text, bytes in `_meta`, one `//` totals line) and `sortBy: 'name' | 'size'`
(largest-first within each directory level, tree shape kept). The default call
changes nothing: same tree, same `_meta`, zero extra syscalls.
Requirements covered: issue #99's four acceptance boxes; no spec file, the
issue is the requirement source.

## Design decisions (settled here; do not re-derive)

- **Sizes come from one guarded `ctx.fs.stat` per file entry, only when
  `includeSizes` or `sortBy: 'size'` was passed.** The walk's `Dirent` carries
  no size ([`path-utils.ts:19-23`](../../../src/core/path-utils.ts#L19-L23)),
  so the issue's "use the data the walk already has / no extra stat pass" is
  not satisfiable: one stat per listed file is the floor, and the default
  path pays none.
- **Totals cover the whole collected set**, not the page: `totalEntries`,
  `totalFiles`, `totalDirectories` are already full-set on every page
  ([`list.ts:266-271`](../../../src/tools/list.ts#L266-L271)), and one line
  that mixes page-scoped bytes with set-scoped counts would lie.
  `pageTrailer`'s `// showing 1-2 of 4 entries.` line already states what the
  page holds, so no "this page only" marker is added. This deviates from one
  sentence in the issue ("Mark it as covering the current page only when the
  listing is paged"); all four acceptance checkboxes still hold.
- **`sortBy: 'size'` without `includeSizes`** collects sizes (needed to sort)
  and they ride `_meta`, but the tree text and totals line stay off. Display
  is gated on `includeSizes` alone.
- **Sorting**: within one parent, directories first (by name, as today), then
  files by size descending, name as tiebreak; a file whose stat failed sorts
  as size 0. Tree shape never changes: the sort plugs into the existing
  same-parent branch.
- **The surface budget is raised deliberately, not worked around.** The two
  new inputs cost +310 chars of `tools/list` JSON (measured against the
  rendered shapes the snapshot pins); with empty descriptions they still
  cost +151, over the 103-char read-only headroom measured at `8fffa76e`
  (full 18 909 / 19 000, read-only 9 047 / 9 150). No string shortening
  passes, so step 2 raises both ceilings with a recorded reason, keeping the
  test's ~2%-above-measurement convention.

## Current state

All excerpts verified against `8fffa76e`.

- [`src/tools/list.ts:24-28`](../../../src/tools/list.ts#L24-L28):
  `interface CollectedEntry { name: string; relativePath: string; type: EntryType; }`
- [`list.ts:30-39`](../../../src/tools/list.ts#L30-L39): `CollectOptions`
  holds `maxDepth, includeHidden, includeIgnored, signal, pathGuard, entryCap,
  onProgress`. No `fs`, no size options.
- [`list.ts:41-46`](../../../src/tools/list.ts#L41-L46): `CollectResult` has
  `entries, totalEntries, totalFiles, totalDirectories`. No bytes.
- [`list.ts:53-66`](../../../src/tools/list.ts#L53-L66): `compareEntries`:
  group by parent path, then directories first (`entryTypeRank`), then
  `name.localeCompare`. Used at
  [`list.ts:120`](../../../src/tools/list.ts#L120) and re-run on page +
  synthesized ancestors inside `renderMarkdown` at
  [`list.ts:163`](../../../src/tools/list.ts#L163).
- [`list.ts:90-106`](../../../src/tools/list.ts#L90-L106): loop core. The
  accessibility skip runs before any counting, so denylisted and vanished
  entries reach neither entries nor totals:

  ```ts
  options.signal.throwIfAborted();
  scanned++;
  options.onProgress({ current: scanned });

  const entryType: EntryType = resolveEntryType(entry.dirent);
  const relPath = toPosixRelative(rootPath, entry.path);
  const name = basename(relPath);

  const accessible = await options.pathGuard.isEntryAccessible(entry.path);
  if (!accessible) continue;

  totalEntries++;
  if (entryType === 'directory') {
    totalDirectories++;
  } else {
    totalFiles++;
  }
  ```

- [`list.ts:114-116`](../../../src/tools/list.ts#L114-L116): the entries
  array is capped by `entryCap` while counting continues past it
  (`totalEntries` is full-set; so must `totalBytes` be).
- [`list.ts:145-196`](../../../src/tools/list.ts#L145-L196):
  `renderMarkdown(rootName, page)`: redraws missing ancestors as context
  (synthetic `{name, relativePath, type: 'directory'}` entries at
  [`list.ts:160`](../../../src/tools/list.ts#L160), never sized), re-sorts,
  and pushes rows at
  [`list.ts:186`](../../../src/tools/list.ts#L186):

  ```ts
  lines.push(prefix + connector + child.name + (child.type === 'directory' ? '/' : ''));
  ```

- [`list.ts:200-215`](../../../src/tools/list.ts#L200-L215):
  `ListInputSchema = z.strictObject({ path, maxDepth, maxEntries,
  includeHidden, includeIgnored, cursor })`. `strictObject` means the new
  inputs must be declared here or calls fail validation.
- [`list.ts:234-236`](../../../src/tools/list.ts#L234-L236): description:
  `"List a directory's files and subdirectories as a tree of names, like ls or tree. " +
  'stat returns sizes and dates.'`. Pinned in the contract snapshot at both
  [`contract.test.ts.snapshot:288`](../../../__tests__/contract.test.ts.snapshot#L288)
  and `:938`.
- [`list.ts:250`](../../../src/tools/list.ts#L250):
  `pageQueryKey('list', { ...args, path: resolvedPath }, ['cursor', 'maxEntries'])`:
  new args join the snapshot key automatically; a cursor minted without
  `includeSizes` never replays a sizes snapshot (it fails as an invalid
  cursor, like the existing test at
  [`tools.test.ts:3337-3344`](../../../__tests__/tools.test.ts#L3337-L3344)
  pins for the other options).
- [`list.ts:264-273`](../../../src/tools/list.ts#L264-L273): `produce`
  returns `items`, `metadata` (`path, totalEntries, totalFiles,
  totalDirectories`), `truncated`.
- [`list.ts:275-287`](../../../src/tools/list.ts#L275-L287): `externalize`
  builds `fullOutput` field by field (`entries, markdown, totalEntries,
  totalFiles, totalDirectories, truncated?`): a new field must be added here
  by hand; nothing spreads `metadata` in.
- [`list.ts:290-296`](../../../src/tools/list.ts#L290-L296): `structured`
  spreads `...paged.metadata`, so a metadata field reaches `_meta` on every
  page for free. `list` ships `_meta` (not `structuredContent`) because it
  authors text ([`define.ts:202-213`](../../../src/tools/define.ts#L202-L213));
  no `outputSchema` is ever published
  ([`define.ts:485-491`](../../../src/tools/define.ts#L485-L491)), so output
  shape changes are TypeScript-only.
- [`list.ts:300-311`](../../../src/tools/list.ts#L300-L311): text =
  `renderMarkdown(...) + pageTrailer({...}) + '\nfull tree at ${uri}'`.
- [`src/core/schema.ts:135-137`](../../../src/core/schema.ts#L135-L137):
  the opt-in-boolean exemplar to reuse:
  `export function defaultFalseBoolean(description) { return z.boolean().default(false).describe(description); }`
- [`src/tools/find-files.ts:34-38`](../../../src/tools/find-files.ts#L34-L38):
  the enum-with-default exemplar to imitate:
  `sortBy: z.enum(['name', 'path']).optional().default('path').describe(...)`.
- [`src/core/fmt.ts:54-56`](../../../src/core/fmt.ts#L54-L56):
  `formatCount(count, singular, plural)` builds `3 files` / `1 directory`.
  `pageTrailer` ([`fmt.ts:106-140`](../../../src/core/fmt.ts#L106-L140)) owns
  the `//`-prefixed position lines and returns `''` when nothing applies.
- **No byte formatter exists anywhere in `src/`** (grep `KiB|formatBytes|toFixed`
  hits comments only); user-facing sizes today are raw byte counts. A new
  helper in `fmt.ts` is required.
- [`src/tools/read.ts:224-231`](../../../src/tools/read.ts#L224-L231): the
  per-file guarded-stat-and-degrade exemplar to imitate:

  ```ts
  try {
    const out = await ctx.fs.stat(path);
    return { index, size: budgetBytes(path, Math.min(out.stats.size, maxSize), mode) };
  } catch (err: unknown) {
    ctx.log('debug', `collectFileBudget: stat failed for "${path}": ${String(err)}`, 'read');
    return undefined;
  }
  ```

- [`src/core/fs.ts:197-204`](../../../src/core/fs.ts#L197-L204):
  `GuardedFileSystem.stat(filePath, options?: { signal?: AbortSignal }): Promise<{ stats: Stats; validPath: string }>`
  revalidates, then stats; the option this plan relies on.
- [`src/core/errors.ts:203`](../../../src/core/errors.ts#L203):
  `rethrowIfAborted(error)`: rethrows cancellations, swallows the rest
  (used in per-entry catches: `stat.ts:95`, `read.ts` via log-and-degrade).
- [`src/core/path.ts:305-317`](../../../src/core/path.ts#L305-L317):
  `isEntryAccessible` returns `false` for sensitive/denylisted paths and
  skippable errors (`ENOENT`, `EACCES`, `ELOOP`); anything else fails the
  listing. Denylist hiding needs no new code.
- Tests: list tests live in
  [`__tests__/tools.test.ts`](../../../__tests__/tools.test.ts) in the
  `P0 Functional Tests - Tools (MCP Client)` describe
  (`before` boots `tmpDir = await createTestRoot(); harness = await
  createTestClientPair([tmpDir])`). Tree-text exemplar:
  [`tools.test.ts:2124-2154`](../../../__tests__/tools.test.ts#L2124-L2154)
  `TC-FUNC-063c`: regex on `firstTextBlock(first).text` including connectors
  and the `// showing` trailer. Denylist exemplar:
  [`tools.test.ts:378-414`](../../../__tests__/tools.test.ts#L378-L414).
  Helpers: `writeTestFile(root, relPath, content)`,
  `firstTextBlock(result)`, `join`, `mkdir`, `writeFile` from `node:fs/promises`.
- Surface budget:
  [`tools.test.ts:3915-3927`](../../../__tests__/tools.test.ts#L3915-L3927)
  `TOOL-SURFACE-002`: `tools/list` JSON must stay ≤ 19 000 chars full and
  ≤ 9 150 read-only (`list` counts in both). Measured at `8fffa76e`:
  18 909 full / 9 047 read-only, headroom 91 / 103. The two new properties
  add +310 chars with the plan's descriptions (19 219 / 9 357) and +151
  even with empty ones, so the ceilings must rise in step 2; the test's
  comment (`tools.test.ts:3905-3914`) allows a raise with a recorded reason.
- Contract: [`__tests__/contract.test.ts:8-13`](../../../__tests__/contract.test.ts#L8-L13)
  documents the regen command (run with no `FS_*` variables set); the `list`
  entry sits at
  [`contract.test.ts.snapshot:286-334`](../../../__tests__/contract.test.ts.snapshot#L286-L334)
  and again at `:936-984` (read-only export): one regen covers both.
- Docs that go stale:
  [`docs/client-guide.md:239-241`](../../../docs/client-guide.md#L239-L241)
  ("draws a tree of names") and
  [`docs/client-guide.md:313`](../../../docs/client-guide.md#L313) (fields
  row, already stale: it omits `totalFiles`/`totalDirectories` that
  [`list.ts:281-283`](../../../src/tools/list.ts#L281-L283) ships today).

## Commands

| Purpose            | Command                                              | Expected on success                       |
| ------------------ | ---------------------------------------------------- | ----------------------------------------- |
| Targeted tests     | `npm test -- --test-name-pattern="#99"`              | exit 1, `fail 4` (step 1); exit 0, 5 pass (step 2+) |
| List + surface     | `npm test -- --test-name-pattern="list\|TC-FUNC-063\|TOOL-SURFACE"` | all pass                    |
| Contract           | `npm test -- --test-name-pattern=CONTRACT`           | all pass (after snapshot regen)           |
| Snapshot regen     | `node --test --test-update-snapshots __tests__/contract.test.ts` | rewrites the `.snapshot`; no FS_* vars set |
| Full gate          | `npm run check`                                      | exit 0                                    |

## Scope

**In scope**: the only files to modify:

- [`src/tools/list.ts`](../../../src/tools/list.ts)
- [`src/core/fmt.ts`](../../../src/core/fmt.ts)
- [`__tests__/tools.test.ts`](../../../__tests__/tools.test.ts)
- [`__tests__/contract.test.ts.snapshot`](../../../__tests__/contract.test.ts.snapshot) (regenerated, not hand-edited)
- [`docs/client-guide.md`](../../../docs/client-guide.md)
- this effort directory

**Files out of scope**: leave alone even though they look related:

- [`src/core/glob.ts`](../../../src/core/glob.ts): the walker yields
  Dirents; there is no size there to expose. All changes fit in `list.ts`'s
  collect loop.
- [`src/core/cursor.ts`](../../../src/core/cursor.ts): `pageQueryKey`
  spreads `args` ([`list.ts:250`](../../../src/tools/list.ts#L250)); the new
  options join the key with no cursor change.
- [`src/core/path.ts`](../../../src/core/path.ts), [`src/core/sensitive.ts`](../../../src/core/sensitive.ts):
  `isEntryAccessible` already drops denylisted entries before counting
  ([`list.ts:98-99`](../../../src/tools/list.ts#L98-L99)).
- [`src/instructions.ts`](../../../src/instructions.ts), [`src/prompts.ts`](../../../src/prompts.ts):
  no sentence there enumerates `list`'s inputs; the snapshot picks the
  description change up automatically.
- [`__tests__/contract.test.ts`](../../../__tests__/contract.test.ts):
  regenerated by flag; the test code itself is untouched.
- [`README.md`](../../../README.md) (`:260`) and [`mcpb/manifest.json`](../../../mcpb/manifest.json)
  (`:31`): both rows stay literally true for the unchanged default.
- [`CHANGELOG.md`](../../../CHANGELOG.md): stamped by the Release workflow.
- [`src/tools/stat.ts`](../../../src/tools/stat.ts): raw bytes on purpose;
  the human formatter is new and lives in `fmt.ts`.

## Steps

### 1. Add the five `#99` tests (red)

In [`__tests__/tools.test.ts`](../../../__tests__/tools.test.ts), immediately
after `TC-FUNC-075b` (ends
[`tools.test.ts:2185`](../../../__tests__/tools.test.ts#L2185)), add these
tests in the existing style (`harness.client.callTool`, `firstTextBlock`,
`_meta` casts, `assert.match` regexes: imitate
[`tools.test.ts:2124-2154`](../../../__tests__/tools.test.ts#L2124-L2154)):

1. `list includeSizes shows sizes and a totals line (#99)`: fixture
   `sizes_dir` with `a.txt` (content `'12345'`, 5 B), `b.txt`
   (`'x'.repeat(1024)`, 1024 B), `c.txt` (`'x'.repeat(1536)`, 1536 B), and
   empty dir `dir1`. Call `{ path: sub, includeSizes: true }`. Assert text
   matches `/a\.txt \(5 B\)/`, `/b\.txt \(1 KiB\)/`, `/c\.txt \(1\.5 KiB\)/`,
   `/dir1\/$/m` (no size on a directory), and the exact line
   `// 3 files, 1 directory, 2.5 KiB total` (5+1024+1536 = 2565 B).
   Assert `_meta.totalFiles === 3`, `_meta.totalDirectories === 1`,
   `_meta.totalBytes === 2565`, and `_meta.entries` carries
   `size` bytes for the three files.
2. `list sortBy size orders files largest first within each directory (#99)`:
   fixture `sort_dir` with `big.txt` (2000 B), `small.txt` (10 B),
   `zero.txt` (0 B), and `mid/` holding `mid.txt` (100 B). Call
   `{ path: sub, maxDepth: 2, includeSizes: true, sortBy: 'size' }`. Assert
   text matches `/mid\/\n│ {3}└── mid\.txt \(100 B\)/` (directory first,
   child under it) then `/big\.txt \(2 KiB\)[\s\S]*small\.txt \(10 B\)[\s\S]*zero\.txt \(0 B\)/`
   (largest first within the level, tree shape kept).
3. `list default output carries no sizes and no totals line (#99)`: a
   characterization pin, green at step 1 on purpose (it pins today's default
   so step 2 cannot regress it; every negative assert already holds at
   `8fffa76e`). Fixture `default_dir` with `a.txt` (5 B) and empty dir
   `dir1`. Call `{ path: sub }`. Assert text does not match `/\(\d/` and
   contains no `//` line; `_meta` has no `totalBytes` key;
   `_meta.entries[0].size === undefined`.
4. `list includeSizes leaves secret files out of the totals (#99)`: fixture
   `secrets_dir` with `.env` (content `'SECRET=1'`, 8 B) and `plain.txt`
   (`'x'`, 1 B). Call `{ path: sub, includeHidden: true, includeSizes: true }`
   (imitate [`tools.test.ts:378-414`](../../../__tests__/tools.test.ts#L378-L414)).
   Assert text does not match `/\.env/`; `_meta.totalFiles === 1`,
   `_meta.totalBytes === 1`, entries names deep-equal `['plain.txt']`.
5. `list includeSizes pages with sizes intact (#99)`: fixture `pages_dir`
   with `f0.txt`–`f3.txt` of sizes 1–4 B (`'x'.repeat(i + 1)`). Call
   `{ path: sub, maxEntries: 2, includeSizes: true, sortBy: 'size' }`.
   Page 1: `_meta.totalBytes === 10`, `entryCount === 2`, entry names
   `['f3.txt', 'f2.txt']`, text shows sizes. Page 2 (same args plus the
   cursor): names `['f1.txt', 'f0.txt']`, sizes still present,
   `_meta.totalBytes === 10` (full set, same on every page). Then replay the
   page-1 cursor with `includeSizes: false` and expect an error result
   matching `/Invalid cursor/` (the option is part of the query key), the
   way [`tools.test.ts:3337-3344`](../../../__tests__/tools.test.ts#L3337-L3344)
   asserts it for the other options.

**Verify**: `npm test -- --test-name-pattern="#99"` → **exit code 1** and the
summary reports `fail 4`, naming the four red `(#99)` tests in the failure
list (test 3 is green from birth: it characterizes the unchanged default and
must stay green through step 2). Each untouched test file still counts as
one passing unit, so expect `pass 44`, not `0 pass` (schema rejects the
unknown `includeSizes`/`sortBy` keys → isError results, asserts fail).

### 2. Implement `fmt.ts` + `list.ts` (green)

In [`src/core/fmt.ts`](../../../src/core/fmt.ts), next to `formatCount`
([`fmt.ts:54-56`](../../../src/core/fmt.ts#L54-L56)):

```ts
const SIZE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** Human-readable byte size for tree lines and summary text: `5 B`, `1 KiB`, `1.5 KiB`, `20 KiB`. */
export function formatByteSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${String(rounded)} ${SIZE_UNITS[unit]}`;
}
```

In [`src/tools/list.ts`](../../../src/tools/list.ts):

- Imports: add `defaultFalseBoolean` to the
  [`schema.ts` import](../../../src/tools/list.ts#L11-L18); add
  `formatByteSize, formatCount` to the
  [`fmt.ts` import](../../../src/tools/list.ts#L7); add
  `import type { GuardedFileSystem } from '../core/fs.ts';`; add
  `rethrowIfAborted` to the
  [`errors.ts` import](../../../src/tools/list.ts#L6).
- `CollectedEntry` gains `size?: number`.
- `CollectOptions` gains `includeSizes: boolean`,
  `sortBy: 'name' | 'size'`, `fs: GuardedFileSystem`.
- `CollectResult` gains `totalBytes: number`.
- Replace `compareEntries` with a comparator factory (keep the existing
  grouping comment):

  ```ts
  function entryComparator(sortBy: 'name' | 'size') {
    return (a: CollectedEntry, b: CollectedEntry): number => {
      const slashA = a.relativePath.lastIndexOf('/');
      const slashB = b.relativePath.lastIndexOf('/');
      const parentA = slashA === -1 ? '' : a.relativePath.slice(0, slashA);
      const parentB = slashB === -1 ? '' : b.relativePath.slice(0, slashB);
      if (parentA !== parentB) return parentA.localeCompare(parentB);
      const rankDiff = entryTypeRank(a.type) - entryTypeRank(b.type);
      if (rankDiff !== 0) return rankDiff;
      if (sortBy === 'size') {
        const sizeDiff = (b.size ?? 0) - (a.size ?? 0);
        if (sizeDiff !== 0) return sizeDiff;
      }
      return a.name.localeCompare(b.name);
    };
  }
  ```

- In `collect`, hoist `const wantSizes = options.includeSizes || options.sortBy === 'size';`
  and init `let totalBytes = 0;`. Between the accessibility `continue`
  ([`list.ts:99`](../../../src/tools/list.ts#L99)) and `totalEntries++`
  ([`list.ts:101`](../../../src/tools/list.ts#L101)) (after the skip, so
  denylisted names are never statted or counted), insert:

  ```ts
  let size: number | undefined;
  if (wantSizes && entryType === 'file') {
    try {
      const out = await options.fs.stat(entry.path, { signal: options.signal });
      size = out.stats.size;
    } catch (error) {
      rethrowIfAborted(error);
      // A file can vanish between the walk and the stat; it keeps its place, without a size.
    }
  }
  ```

  In the counting branch add `if (size !== undefined) totalBytes += size;`
  inside the `else` (`totalFiles++`) arm; build the entry with
  `...(size !== undefined ? { size } : {})`. Sort with
  `entries.sort(entryComparator(options.sortBy));`
  ([`list.ts:120`](../../../src/tools/list.ts#L120)) and return `totalBytes`
  in `CollectResult`.
- `renderMarkdown` takes a third parameter
  `opts?: { includeSizes?: boolean; sortBy?: 'name' | 'size' }`; sort at
  [`list.ts:163`](../../../src/tools/list.ts#L163) with
  `entryComparator(opts?.sortBy ?? 'name')`; the row at
  [`list.ts:186`](../../../src/tools/list.ts#L186) becomes:

  ```ts
  const sizeText =
    opts?.includeSizes && child.size !== undefined ? ` (${formatByteSize(child.size)})` : '';
  lines.push(
    prefix + connector + child.name + (child.type === 'directory' ? '/' : '') + sizeText,
  );
  ```

  (Synthetic ancestor entries at
  [`list.ts:160`](../../../src/tools/list.ts#L160) are directories with no
  size, so they stay bare.)
- `ListPageMetadata` gains `readonly totalBytes?: number`.
- In `run`, hoist
  `const wantSizes = args.includeSizes || args.sortBy === 'size';`; pass
  `includeSizes: args.includeSizes, sortBy: args.sortBy, fs: ctx.fs` into
  `collect` ([`list.ts:255-263`](../../../src/tools/list.ts#L255-L263));
  add `...(wantSizes ? { totalBytes: result.totalBytes } : {})` to the
  `metadata` literal
  ([`list.ts:266-271`](../../../src/tools/list.ts#L266-L271)).
- `externalize` ([`list.ts:275-287`](../../../src/tools/list.ts#L275-L287)):
  render the markdown with
  `{ includeSizes: args.includeSizes, sortBy: args.sortBy }` and add
  `...(metadata.totalBytes !== undefined ? { totalBytes: metadata.totalBytes } : {})`
  to `fullOutput` by hand.
- New module-level helper (used by the text path only; the stored resource
  keeps its raw-JSON shape):

  ```ts
  /** The `//` line `includeSizes` appends: counts and bytes over the whole collected set. */
  function summaryLine(metadata: {
    totalFiles: number;
    totalDirectories: number;
    totalBytes?: number;
  }): string {
    return `\n\n// ${formatCount(metadata.totalFiles, 'file')}, ${formatCount(
      metadata.totalDirectories,
      'directory',
    )}, ${formatByteSize(metadata.totalBytes ?? 0)} total`;
  }
  ```

- Text assembly ([`list.ts:300-311`](../../../src/tools/list.ts#L300-L311)):

  ```ts
  const text =
    renderMarkdown(treeHeader(ctx.fs.pathGuard, paged.metadata.path), [...paged.page], {
      includeSizes: args.includeSizes,
      sortBy: args.sortBy,
    }) +
    (args.includeSizes ? summaryLine(paged.metadata) : '') +
    pageTrailer({ /* unchanged */ }) +
    (structured.resourceUri !== undefined ? `\nfull tree at ${structured.resourceUri}` : '');
  ```

- Schema ([`list.ts:200-215`](../../../src/tools/list.ts#L200-L215)): add
  after `includeIgnored`, before `cursor`:

  ```ts
  includeSizes: defaultFalseBoolean(
    'Show file sizes in the tree and a totals line of counts and bytes',
  ),
  sortBy: z
    .enum(['name', 'size'])
    .optional()
    .default('name')
    .describe('Order within each directory: name (default) or size (largest first)'),
  ```

- Description ([`list.ts:234-236`](../../../src/tools/list.ts#L234-L236)):

  ```ts
  description:
    "List a directory's files and subdirectories as a tree of names, like ls or tree. " +
    'includeSizes adds sizes and a total; stat returns dates.',
  ```

- Budget raise, in the same test file
  ([`tools.test.ts:3916-3917`](../../../__tests__/tools.test.ts#L3916-L3917)):
  `BUDGET_CHARS` 19 000 → 19 600, `BUDGET_CHARS_READ_ONLY` 9 150 → 9 550
  (each ~2% above the post-change measurement, the convention the history
  comment states), and append one line to that comment
  ([`tools.test.ts:3905-3914`](../../../__tests__/tools.test.ts#L3905-L3914)):

  ```ts
  // Raised 2026-10-15 to 19600 full / 9550 read-only: `list` gains opt-in
  // includeSizes and sortBy inputs (#99); measured 19219 / 9357.
  ```

  Keep the comment's measured numbers in sync with the actual post-change
  sizes if they differ. The tool-count assert below the constants stays 13.

**Verify**: `npm test -- --test-name-pattern="#99|TC-FUNC-063|TOOL-SURFACE"` →
**exit 0, `fail 0`**, including `TOOL-SURFACE-002` against the raised
ceilings (post-change measurement ~19 219 full / 9 357 read-only, headroom
~380 / ~190) and the untouched
`TC-FUNC-063/063b/063c/075/075b` list tests (default output unchanged).

### 3. Regenerate the contract snapshot

1. Confirm no `FS_*` variables are set in the shell
   (`Get-ChildItem env:FS_*` in PowerShell prints nothing).
2. Run `node --test --test-update-snapshots __tests__/contract.test.ts`.
3. Inspect the `.snapshot` diff: it must contain, in both exports
   ([`:286-334`](../../../__tests__/contract.test.ts.snapshot#L286-L334) and
   `:936-984`), only the new `list` description, the `includeSizes` property,
   and the `sortBy` property. Any other hunk is a STOP.

**Verify**: `npm test -- --test-name-pattern=CONTRACT` → **both pass**.

### 4. Update `docs/client-guide.md`

- [`client-guide.md:239-241`](../../../docs/client-guide.md#L239-L241):
  extend the sentence (keep it one thought, same register):

  > `list` draws a tree of names and keeps `relativePath` relative to its
  > `path`; the tree's first line names a listed subfolder the same way
  > (`src/core`). With `includeSizes`, each file's size rides its tree line
  > and a `// N files, M directories, X total` line closes the listing;
  > `sortBy: 'size'` orders files largest-first within each directory.

- [`client-guide.md:313`](../../../docs/client-guide.md#L313): replace the
  `list` row (it is already stale: `totalFiles`/`totalDirectories` ship today
  and are undocumented):

  ```markdown
  | `list` | `path`, `entries[]` (`name`, `relativePath`, `type`, `size` with `includeSizes`/`sortBy: 'size'`), `totalEntries`, `totalFiles`, `totalDirectories`, `totalBytes` (with the same options), `nextCursor` |
  ```

**Verify**: `npm run check` → **exit 0** (static + full suite + coverage
floor; this is also the Done gate).

## Done

All must hold:

- [ ] `npm run check` exits 0.
- [ ] `npm test -- --test-name-pattern="#99"` shows 5 passing tests.
- [ ] `git status --short` lists only `src/tools/list.ts`, `src/core/fmt.ts`,
      `__tests__/tools.test.ts`, `__tests__/contract.test.ts.snapshot`,
      `docs/client-guide.md`, and this effort directory.

## STOP

Stop and report if:

- A [Current state](#current-state) excerpt does not match the live code
  (run the header's drift check first).
- `TOOL-SURFACE-002` still fails after the step-2 budget raise: apply the
  pre-authorized fallback once (`includeSizes` description `Show file sizes
  and a totals line`, `sortBy` description `Sort by size (largest first)
  instead of name`, and drop the description edit's `includeSizes adds
  sizes and a total;` clause). A second failure means the surface grew for
  another reason; report rather than raising again.
- Any test other than the five new ones fails after step 2 and still fails
  after one fix attempt.
- The fix appears to need `src/core/glob.ts`, `src/core/cursor.ts`, or an
  `outputSchema`: the design says it does not.
- A step's verification fails twice after one fix attempt: the step's
  assumption is wrong, not its implementation.

## Notes

- **Issue premise correction**: the walk's `Dirent` has no size, so
  `includeSizes` costs one guarded `ctx.fs.stat` per listed file (default
  path: zero). The call is still bounded by the existing 5 s deadline.
- **Totals scope**: full collected set on every page (matches
  `totalEntries`/`totalFiles` semantics); `pageTrailer`'s `// showing X-Y of
  Z entries.` line states what the page holds. This deliberately drops the
  issue's "mark as covering the current page only when the listing is paged"
  sentence: one scope for every number in the line. The issue author
  reviews this plan; flag this decision in the PR.
- `sortBy: 'size'` alone still collects sizes (they ride `_meta`), but the
  tree text and totals line appear only with `includeSizes`.
- A file whose stat fails mid-walk keeps its place, has no size, and is
  excluded from `totalBytes`.
- Reviewer should scrutinize: `formatByteSize` rounding (test A pins
  `5 B`, `1 KiB`, `1.5 KiB`, `2.5 KiB total`), the queryKey picking up the
  new options (test E's invalid-cursor assert), and the budget headroom.
- Deferred: sizes on directories, a global (cross-directory) size order, and
  a per-page byte total: none asked for by the acceptance list.
- Rollback: `git checkout -- <files>` and `git clean -fd docs/plan/2026-10-15-list-sizes/`;
  no migrations, no deletions, no data.
- Route: handed to plan-hunt (contract + budget + paging interactions are
  exactly where a cold plan dies).