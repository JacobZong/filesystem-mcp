# Plan 070: An `includeHidden` walk reads the tree once, not up to three times

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8deb0d50..HEAD -- src/core/glob.ts src/tools/list.ts src/core/search.ts src/tools/replace-text.ts src/tools/move.ts __tests__/glob.test.ts`
> Plans 065 and 069 are expected to have changed `glob.ts` (validation and
> `dotVariant`). Compare only the `processGlobPattern` / `globEntries`
> excerpts below; a mismatch there is a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW–MED — the order in which a hidden walk yields entries
  changes, and a mid-walk error now ends every variant at once.
- **Depends on**: 065, 069 (same file; land them first)
- **Category**: perf
- **Planned at**: commit `8deb0d50`, 2026-10-13

## Why this matters

With `includeHidden: true`, `buildHiddenPatterns` turns one pattern into up
to three (for `**/*`: `**/*`, `**/.*/**/*` and `**/.*`). `globEntries` then
runs a separate `fs.glob` walk for each, one after another. Each walk reads
every directory of the tree. `list` (which defaults to `**/*`),
`find_files`, `search_text`, `replace_text` and directory `move`/copy all
pay this.

Measured during the audit on `C:/filesystem-mcp/node_modules` (9 350
entries, warm cache, two runs): three separate walks took 172 + 155 + 155 ms
(about 485 ms). The same three patterns passed as one array to `fs.glob`
took about 250 ms and yielded the same 9 513 entries. About 1.9× on every
hidden walk; the gap grows with the tree.

`fs.glob` (`node:fs/promises`) accepts `string | string[]`. The existing
`seen` set already drops duplicates.

## Current state

- `src/core/glob.ts:605-644` `processGlobPattern(pattern, plan, seen, onlyFiles, filter, signal)`:

  ```ts
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
      if (filter.isExcluded(match)) continue;
      yield * processDirentMatch(match, cwd, maxDepth, seen, onlyFiles);
    }
  } catch (error) {
    if (!suppressErrors) throw error;
    Logger.warn(
      `globEntries: suppressed mid-walk error for pattern "${pattern}": ${formatUnknownErrorMessage(error)}`,
    );
  }
  signal?.throwIfAborted();
  ```

- `src/core/glob.ts:646-671` `globEntries`, ending with:

  ```ts
  for (const pattern of plan.patterns) {
    yield * processGlobPattern(pattern, plan, seen, onlyFiles, filter, options.signal);
  }
  ```

- `NormalizedGlob.patterns` is `readonly string[]` from
  `normalizeGlobOptions` (`:508-527`): `[normalizedPattern]` without
  `includeHidden`, `buildHiddenPatterns(normalizedPattern)` with it.
- Consumers of `globEntries`: `src/core/search.ts:370`, `:505`;
  `src/tools/list.ts:103`; `src/tools/move.ts:481`;
  `src/tools/replace-text.ts:504`.
- `__tests__/glob.test.ts:17-24` — the `walk` helper sorts its output, so
  glob unit tests do not depend on yield order.

## Commands you will need

| Purpose    | Command                                                   | Expected on success |
| ---------- | --------------------------------------------------------- | ------------------- |
| Install    | `npm ci`                                                  | exit 0              |
| Glob tests | `node --test --test-timeout=60000 __tests__/glob.test.ts` | all pass            |
| Full suite | `npm test`                                                | all pass            |
| Full check | `npm run check`                                           | exit 0              |

## Scope

**In scope**: `src/core/glob.ts` (`processGlobPattern`, `globEntries`),
`__tests__/glob.test.ts`, `plans/README.md` (status row).

**Out of scope**: `buildHiddenPatterns` and its helpers (which patterns are
built does not change), `createWalkFilter`, `processDirentMatch`,
`GitignoreManager`, every consumer file. No CHANGELOG entry: no visible
behavior changes.

## Git workflow

- Branch: `advisor/070-include-hidden-one-walk` (on top of 069).
- Message style, e.g. `perf(glob): walk the hidden pattern variants in one fs.glob call`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Check that no consumer depends on yield order

For each consumer listed above, read the code that iterates the walk and
answer: does it stop early or cap the set **in walk order** (a `break`, a
`maxFiles`/`maxEntries`/`maxResults` count, a "first match" choice), and
would an interleaved order change which entries survive?

Known so far: `search_text` sorts results (`src/tools/search-text.ts:176`);
`move.ts:481` counts protected entries over the whole tree. Check `list.ts`
(`collect`, `:95-…`) and `replace-text.ts:504` (`maxFiles`, and which file
becomes `summary.primary`) yourself.

Today the order is "all of pattern 1, then all of pattern 2, …". A capped
consumer currently fills its cap with non-hidden entries first. After this
plan, hidden and non-hidden entries interleave in directory order.

**Verify**: write your answer as one line per consumer in the commit
message body. If a consumer caps in walk order **and** a test pins which
entries survive the cap, STOP and report before step 2.

### Step 2: One `fs.glob` call for all patterns

Change `processGlobPattern` to take `patterns: readonly string[]` instead of
`pattern: string`:

- Pass `[...patterns]` (or `patterns` if the type accepts a readonly array)
  to `fsGlob`.
- In the warn message, use `patterns.join(', ')` for the pattern text.
- Rename it to `processGlobPatterns`.

Replace the loop in `globEntries` with:

```ts
// One walk for every variant: fs.glob reads each directory once and matches
// all of them, where a walk per variant re-read the tree for each.
yield * processGlobPatterns(plan.patterns, plan, seen, onlyFiles, filter, options.signal);
```

Keep `seen`; `fs.glob` may still yield one path for two patterns.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0;
`node --test --test-timeout=60000 __tests__/glob.test.ts` → all pass.

### Step 3: Pin "each entry once" across overlapping variants

In `__tests__/glob.test.ts`, add
`'an includeHidden walk yields each entry once across its pattern variants'`:
build `a.txt`, `.b.txt`, `.d/c.txt`, `.d/.e.txt`, `sub/.f.txt`; collect
`globEntries({ cwd: root, pattern: '**/*', includeHidden: true })` **without**
the sorting `walk` helper, map to relative POSIX paths, and assert
`new Set(paths).size === paths.length` and that the sorted list equals
`['.b.txt', '.d/.e.txt', '.d/c.txt', 'a.txt', 'sub/.f.txt']`.

**Verify**: `node --test --test-timeout=60000 __tests__/glob.test.ts` → all pass.

### Step 4: Measure (not committed)

In a scratch file outside the repo, time 5 runs each of the old and new
build against a large directory (for example `node_modules`), e.g.:

```js
import { globEntries } from '<repo>/src/core/glob.ts';

// run with node 24
const t = performance.now();
let n = 0;
for await (const _ of globEntries({
  cwd: '<repo>/node_modules',
  pattern: '**/*',
  includeHidden: true,
  onlyFiles: false,
}))
  n++;
console.log(n, Math.round(performance.now() - t), 'ms');
```

Run it once on the commit before step 2 (`git stash` is not needed: use
`git worktree add` or check out the previous commit in a scratch clone) and
once after. Put the medians in the commit message.

**Verify**: entry counts are equal; the new median is lower. If it is not
lower, STOP and report the numbers.

### Step 5: Full check

**Verify**: `npm run check` → exit 0.

## Test plan

- New: one walk over overlapping hidden variants yields each entry once.
- Existing: every `includeHidden` test in `glob.test.ts` and every tool test
  (they compare sorted sets or per-file results).

## Done criteria

- [ ] `npm run check` exits 0
- [ ] `grep -n "for (const pattern of plan.patterns)" src/core/glob.ts` → no match
- [ ] Commit message records the consumer order check and the before/after medians
- [ ] Only in-scope files changed; `plans/README.md` row 070 updated

## STOP conditions

- The excerpts of `processGlobPattern` / `globEntries` do not match.
- Step 1 finds a capped consumer whose surviving set a test pins.
- Any existing test fails after step 2.
- Step 4 shows no speedup.

## Maintenance notes

- A mid-walk error with `suppressErrors` now ends all variants, where before
  it ended only one. The walk stays best-effort; the warn line names every
  pattern.
- If yield order ever matters to a consumer, sort in that consumer rather
  than reintroducing per-pattern walks.
