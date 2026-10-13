# Plan 065: A glob pattern can no longer freeze the server

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8deb0d50..HEAD -- src/core/glob.ts src/core/schema.ts __tests__/glob.test.ts CHANGELOG.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW–MED — a few rare glob shapes that were accepted become
  validation errors. Ordinary patterns (`**/*.ts`, `*.{ts,tsx}`,
  `*foo*bar*`, `.!(git|svn|hg)`) keep working.
- **Depends on**: none. Run before 069 and 070, which also edit
  `src/core/glob.ts`.
- **Category**: security
- **Planned at**: commit `8deb0d50`, 2026-10-13

## Why this matters

`find_files`, `search_text` and `replace_text` pass the caller's `pattern`
to Node's `fs.glob`. Node compiles each path segment of the pattern to a
JavaScript regular expression and tests every directory entry name against
it, **synchronously**. Some glob shapes compile to regexes that backtrack
exponentially or with a high polynomial degree. The match then blocks the
event loop for seconds to forever. The tool timeout and client cancellation
cannot fire, because they need the event loop. Over HTTP, every client and
`/healthz` stop responding. `find_files` and `search_text` stay registered
in `--read-only` mode, so a read-only client can do this too.

Measured on Node 24 with `path.matchesGlob`, which uses the same engine as
`fs.glob`. The name is the letter `a` repeated N times:

| Pattern (one segment)                                 | N=22   | N=40 or 255                   |
| ----------------------------------------------------- | ------ | ----------------------------- |
| `*(?\|?)#`                                            | 136 ms | N=40: did not finish in 300 s |
| `*(*)#`                                               | 668 ms | —                             |
| `*(a\|a)#`                                            | 214 ms | N=40: did not finish          |
| `*(@(a\|a))#`                                         | 213 ms | —                             |
| `?(*)?(*)?(*)?(*)?(*)?(*)#`                           | 18 ms  | N=80: 15 460 ms               |
| `*a*a*a*a*a*a*a*a*a*a*b`                              | 19 ms  | N=40: over 20 s               |
| `*a*a*a*b` (4 star runs)                              | —      | N=255: 1 025 ms               |
| `*a*a*a*a*b` (5 runs)                                 | —      | N=255: over 30 s              |
| `*a*a*b` (3 runs)                                     | —      | N=255: 19 ms                  |
| `?(*)?(*)?(*)#` (3 runs)                              | —      | N=255: 86 ms                  |
| `a**a**b` (runs of `*`)                               | —      | N=255: 4 ms                   |
| `*(ab\|a)#`, `*(?)#`, `*([a-z])#`, `.!(git\|svn\|hg)` | 0–4 ms | 0–4 ms                        |

Two shapes cause the blowup:

1. **A repeated extglob group** (`*(…)` or `+(…)`) whose body can match in
   more than one way: it holds `|`, `*`, or a nested group `(`.
2. **Too many unbounded wildcards in one segment.** A run of consecutive
   `*` characters behaves like one `*`. A `+(` group is also unbounded.
   Three runs cost at most about 90 ms on a 255-character name; four cost
   about 1 s; five do not finish.

After this plan, `isSafeGlobSyntax` refuses both shapes. The tools reject
such a pattern with the existing `Invalid glob or unsafe path …` validation
error, before any walk starts.

## Current state

- `src/core/glob.ts` — glob walks and pattern validation.
  - `:13-22` — the existing caps, with the comment style to match:

    ```ts
    /**
     * More brace alternatives than this is not a file filter. fs.glob's matcher
     * dedupes its alternatives pairwise, synchronously: `{1..100000}` pins the
     * event loop for most of a minute, where 1024 costs tens of milliseconds.
     */
    export const MAX_BRACE_ALTERNATIVES = 1024;

    /** Bound synchronous glob compilation when checking candidate traversal segments. */
    export const MAX_DOTDOT_CHECK_CHARS = 4096;
    ```

  - `:138-162` — `isSafeGlobSyntax`. It expands brace sets, collects every
    `/`-separated segment of every alternative into a `Set`, then checks
    each segment for a `..` spelling:

    ```ts
    export function isSafeGlobSyntax(pattern: string): boolean {
      if (!pattern || pattern.trim().length === 0) {
        return false;
      }
      // ... comment ...
      const alternatives = expandBraceSets(toPosixPath(pattern));
      if (!alternatives) return false;
      const segments = new Set<string>();
      for (const alternative of alternatives) {
        if (isRooted(alternative)) return false;
        for (const segment of alternative.split('/')) segments.add(segment);
      }
      let dotdotCheckChars = 0;
      for (const segment of segments) {
        if (!segment.includes('.') || !DOTDOT_SPELLING_RE.test(segment)) continue;
        dotdotCheckChars += segment.length;
        if (dotdotCheckChars > MAX_DOTDOT_CHECK_CHARS || isTraversalSegment(segment)) return false;
      }
      return true;
    }
    ```

- `src/core/schema.ts:65-77` — `SafeGlobPattern`, the Zod schema that every
  tool's `pattern` field uses. Its refusal message lists the rules:

  ```ts
  isSafeGlobSyntax(val)
    ? undefined
    : `Invalid glob or unsafe path (absolute/.. forbidden, at most ${String(MAX_BRACE_ALTERNATIVES)} brace alternatives and ${String(MAX_DOTDOT_CHECK_CHARS)} traversal-check characters)`,
  ```

  `SafeGlobPattern` is used by `src/tools/find-files.ts:28`,
  `src/tools/search-text.ts:39` and `src/tools/replace-text.ts:51`. Those
  files need no change.

- `__tests__/glob.test.ts:86-200` — `describe('isSafeGlobSyntax', …)`.
  Two existing tests matter:
  - `:143-167` "accepts brace sets, ranges and classes that stay below the
    root" lists patterns that must stay accepted, including `.!(git)`,
    `**/.!(git|svn|hg)`, `**/?(.)*` and `@(.|)*`. All of them pass the new
    rules. Do not remove any of them.
  - `:169-176` builds `` `{0..1023}.${'*.'.repeat(495)}` `` and expects
    `true`. That segment holds 495 `*` runs, so the new rule refuses it.
    The test is about the speed of the `..` check, not about stars; step 3
    switches it to `?`.
- `__tests__/glob.test.ts:251-285` — "find_files, search_text and
  replace_text refuse a brace-built .. (issue #68)". This is the pattern
  for the tool-level test in step 4: it calls each tool through
  `createTestClientPair([root])` and asserts `isError` plus
  `/unsafe path/u` in the text.

Repo conventions: TypeScript ESM with `.ts` import suffixes, `u` flag on
every regex, `const` arrow helpers or `function` declarations with a JSDoc
line above. Comments explain _why_ in full sentences (see the
`MAX_BRACE_ALTERNATIVES` comment above).

## Commands you will need

| Purpose           | Command                                                   | Expected on success |
| ----------------- | --------------------------------------------------------- | ------------------- |
| Install           | `npm ci`                                                  | exit 0              |
| One test file     | `node --test --test-timeout=60000 __tests__/glob.test.ts` | all pass            |
| Contract snapshot | `node --test __tests__/contract.test.ts`                  | all pass            |
| Full check        | `npm run check`                                           | exit 0              |
| Format your edits | `npx prettier --write <files>`                            | exit 0              |

Run tests with no `FS_*` environment variables set.

## Scope

**In scope** (the only files you should modify):

- `src/core/glob.ts`
- `src/core/schema.ts`
- `__tests__/glob.test.ts`
- `CHANGELOG.md`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):

- `src/tools/*.ts` — they already route through `SafeGlobPattern`.
- `src/core/sensitive.ts` — its `matchesGlob` calls take operator-supplied
  `--deny`/`--allow` patterns, not client input.
- The walk itself (`globEntries`, `processGlobPattern`, `buildHiddenPatterns`)
  — plans 069 and 070 change those.
- Running the walk in a worker thread. That is the heavier alternative; not
  this plan.
- `package.json`, `server.json`, `mcpb/manifest.json` versions (the Release
  workflow owns them).

## Git workflow

- Branch: `advisor/065-glob-backtracking-refusal`
- One commit per step is fine. Message style matches `git log`, e.g.
  `fix(glob): refuse wildcard shapes that backtrack`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the backtracking check to `src/core/glob.ts`

Below `MAX_DOTDOT_CHECK_CHARS`, add the cap with a comment that carries the
measurement:

```ts
/**
 * fs.glob tests each name against a regex compiled from the segment,
 * synchronously. Every unbounded wildcard (a run of `*`, or a `+(` group) adds
 * a degree of backtracking: on a 255-character name three cost under 100 ms,
 * four about 1 s, and five do not finish.
 */
export const MAX_SEGMENT_WILDCARDS = 3;
```

Add a helper above `isSafeGlobSyntax` (after `isRooted` is fine):

```ts
/**
 * Whether matching this brace-free segment can backtrack for seconds on one
 * long name. Two shapes do: a repeated group (`*(…)`, `+(…)`) whose body can
 * match more than one way (`|`, `*`, or a nested group), and more than
 * MAX_SEGMENT_WILDCARDS unbounded wildcards in the segment.
 */
function canBacktrack(segment: string): boolean {
  if (segment === '**') return false;
  let wildcards = (segment.match(/\*+/gu) ?? []).length;
  for (let i = segment.indexOf('('); i !== -1; i = segment.indexOf('(', i + 1)) {
    const opener = segment[i - 1];
    if (opener !== '*' && opener !== '+') continue;
    if (opener === '+') wildcards++;
    const close = segment.indexOf(')', i + 1);
    const body = segment.slice(i + 1, close === -1 ? undefined : close);
    if (/[|*(]/u.test(body)) return true;
  }
  return wildcards > MAX_SEGMENT_WILDCARDS;
}
```

Notes for the executor:

- The `*` of a `*(` opener is already counted by the `/\*+/gu` match. Do not
  count it twice.
- `indexOf(')')` finds the first `)`. For a nested group (`*(@(a))`) the
  body slice then contains `(`, which is refused. That is intended.
- An unterminated `*(` (no `)`) takes the rest of the segment as its body.
  That is conservative and fine.

In `isSafeGlobSyntax`, add one check at the top of the existing
`for (const segment of segments)` loop, before the `..` check:

```ts
for (const segment of segments) {
  if (canBacktrack(segment)) return false;
  if (!segment.includes('.') || !DOTDOT_SPELLING_RE.test(segment)) continue;
  ...
```

Because `segments` holds the segments of every brace alternative, a
pattern like `{x,*a*a*a*b}` is caught too.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 2: Name the new rule in the schema error

In `src/core/schema.ts`, import `MAX_SEGMENT_WILDCARDS` next to the other
two constants from `./glob.ts`, and extend the message:

```ts
: `Invalid glob or unsafe path (absolute/.. forbidden, at most ${String(MAX_BRACE_ALTERNATIVES)} brace alternatives, ${String(MAX_DOTDOT_CHECK_CHARS)} traversal-check characters, and ${String(MAX_SEGMENT_WILDCARDS)} * wildcards per path segment; no |, * or nested group inside *(…) or +(…))`,
```

Keep the leading `Invalid glob or unsafe path (` unchanged: tests match on
`/unsafe path/u`.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 3: Update the unit tests in `__tests__/glob.test.ts`

1. In the test at `:169-176`, change the pattern from
   `` `{0..1023}.${'*.'.repeat(495)}` `` to
   `` `{0..1023}.${'?.'.repeat(495)}` `` and change the comment's "holds
   `*`" to "holds `?`". `?` is not in `DOTDOT_SPELLING_RE`, so the test still
   proves that no segment costs a compile.
2. Inside `describe('isSafeGlobSyntax', …)`, add:

```ts
it('refuses wildcard shapes whose match backtracks on a long name', () => {
  for (const bad of [
    '**/*(?|?)#',
    '*(a|a)x',
    '*(*)x',
    '*(a*)x',
    '+(?|?)x',
    '*(@(a|a))x',
    '*a*a*a*b',
    '**a**a**a**b',
    '?(*)?(*)?(*)?(*)x',
    '+(a)+(b)+(c)+(d)x',
    'src/{x,*a*a*a*b}/y',
  ]) {
    assert.strictEqual(isSafeGlobSyntax(bad), false, bad);
  }
});

it('accepts wildcard shapes that match in bounded time', () => {
  for (const ok of [
    '**/*.ts',
    '**/**/*.ts',
    '*foo*bar*',
    '*.test.*',
    'a**a**b',
    '*(z)oo.txt',
    '*(ab)x',
    '*(?)x',
    '+([ab])x',
    '?(*)?(*)?(*)x',
    '.!(git|svn|hg)',
    '@(.|)*',
  ]) {
    assert.strictEqual(isSafeGlobSyntax(ok), true, ok);
  }
});
```

**Verify**: `node --test --test-timeout=60000 __tests__/glob.test.ts` → all
pass, including the two new tests.

### Step 4: Add a tool-level test

Add a test next to the issue #68 test (`__tests__/glob.test.ts:251`),
modelled on it: one root with one file whose name is 40 `a` characters
(`'a'.repeat(40)`), then call `find_files`, `search_text`
(`searchPattern: 'x'`) and `replace_text`
(`searchPattern: 'x', replacement: 'y', dryRun: true`) with
`pattern: '**/*(?|?)#'`. Assert for each:

- `result.isError === true`
- the text matches `/unsafe path/u`
- the whole loop finishes in under 5 000 ms (`performance.now()` before
  and after). Without step 1 it would hang, so the test's own timeout would
  catch a regression too.

**Verify**: `node --test --test-timeout=60000 __tests__/glob.test.ts` → all
pass.

### Step 5: CHANGELOG

At the top of `CHANGELOG.md`, below the intro paragraph and above
`## [2.8.1]`, add an `## [Unreleased]` section if none exists, with:

```markdown
### Security

- **A glob pattern can no longer freeze the server.** `find_files`,
  `search_text` and `replace_text` refuse a pattern that puts `|`, `*` or a
  nested group inside `*(…)` or `+(…)`, or that has more than three `*`
  wildcards in one path segment. Node matches globs synchronously, and such
  patterns backtracked for minutes on one long file name, blocking every
  client. The refusal is the usual `Invalid glob or unsafe path` error.
```

**Verify**: `npx prettier --check CHANGELOG.md` → exit 0 (run
`npx prettier --write CHANGELOG.md` first if needed).

### Step 6: Full check

**Verify**: `npm run check` → exit 0. `node --test __tests__/contract.test.ts`
→ all pass. The contract snapshot holds tool schemas; a Zod refinement
message is not part of the JSON schema, so the snapshot should not change.

## Test plan

- Unit: the two new `isSafeGlobSyntax` tests in step 3 (11 refused shapes,
  12 accepted shapes), plus the adjusted 1024-segment speed test.
- Tool level: step 4, all three tools refuse `**/*(?|?)#` quickly.
- Regression: all existing `isSafeGlobSyntax` accept lists stay green.

## Done criteria

- [ ] `npm run check` exits 0
- [ ] `node --test __tests__/contract.test.ts` passes with no snapshot change
- [ ] `grep -n "MAX_SEGMENT_WILDCARDS" src/core/glob.ts src/core/schema.ts` shows the constant defined in glob.ts and used in schema.ts
- [ ] `git status` shows changes only in the in-scope files
- [ ] `plans/README.md` row 065 updated

## STOP conditions

- `isSafeGlobSyntax` or `SafeGlobPattern` no longer looks like the excerpts.
- Any pattern in the existing accept lists (`:87-97`, `:143-167`) starts to
  fail. Report which one; do not drop it from the list.
- `contract.test.ts` fails. Report the diff; do not update the snapshot.
- Any accepted pattern in step 3's accept list takes over 1 s in
  `path.matchesGlob(('a'.repeat(255)), pattern + '#')`. Report the
  measurement instead of loosening or tightening the cap on your own.

## Maintenance notes

- The cap follows Node's glob engine (`fs.glob`, minimatch-derived). If a
  Node major changes how segments compile, re-measure with the table in
  "Why this matters" and adjust `MAX_SEGMENT_WILDCARDS`.
- If a user reports a legitimate pattern refused, the narrowest loosening is
  to allow `|` inside `*(…)` only when every alternative is a fixed-length
  literal. Measure first: `*(a|a)` is fixed-length and still blows up,
  because its alternatives overlap.
- Plan 069 changes `dotVariant` for `!(` segments, and plan 070 merges the
  hidden-pattern walks. Neither changes this check.
