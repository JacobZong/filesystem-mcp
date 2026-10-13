# Plan 073: Count every extglob group toward the glob wildcard cap

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. The reviewer maintains `plans/README.md`.
>
> **Base and drift check (run first)**: this plan builds on branch
> `advisor/065-071-integration` at `47d4e69f` (PR #85).
> `git fetch origin && git checkout -b advisor/073-pr85-second-review 47d4e69f`,
> then `git diff --stat 47d4e69f..origin/advisor/065-071-integration`. If that
> prints anything, STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW–MED. A few more extglob-heavy patterns are refused.
- **Depends on**: 065, 072 (on the PR branch)
- **Category**: security
- **Planned at**: commit `47d4e69f`, 2026-10-13

## Why this matters

The second Copilot review on PR #85 found four issues. The advisor checked
them:

1. **Bounded extglob chains still freeze matching.** `canBacktrack` counts
   only `*` runs and `+(` groups. A chain of `?(…)` or `@(…)` groups with
   overlapping alternatives backtracks just as badly. Measured with
   `path.matchesGlob`: pattern `'?(a|aa)'.repeat(k) + 'b'` against
   `'a'.repeat(k) + 'c'` took 5 ms at k=10, 752 ms at k=16, and did not
   finish in 30 s at k=20. `isSafeGlobSyntax` accepts the k=40 pattern today.
   With at most three groups per segment, matching stays fast even with many
   alternatives: three `@(a|aa|…|a×30)` groups plus `b` against 250 `a`
   characters plus `c` took 6 ms.
2. **The binary link check ignores the JSON envelope.** In
   `src/core/file-uri.ts`, `overStdioRead` compares only the base64 payload
   (`4 * Math.ceil(size / 3)`) with `MAX_OUTBOUND_RESULT_BYTES`. The read
   adds the URI, MIME and field names, so a file exactly at that edge gets a
   link the read refuses.
3. and 4. **The CHANGELOG bullet and the schema error do not say that groups
   count toward the cap.** After fix 1, every extglob group counts, so both
   texts must say so.

## Current state

- `src/core/glob.ts`, `canBacktrack` (current, verbatim):

  ```ts
  function canBacktrack(segment: string): boolean {
    if (segment === '**') return false;
    let wildcards = (segment.match(/\*+/gu) ?? []).length;
    for (let i = segment.indexOf('('); i !== -1; i = segment.indexOf('(', i + 1)) {
      const opener = segment[i - 1];
      if (opener !== '*' && opener !== '+') continue;
      if (opener === '+') wildcards++;
      const close = groupClose(segment, i);
      // Classes are literals: only `|`, `*` or a group outside one can backtrack.
      const body = segment
        .slice(i + 1, close === -1 ? undefined : close)
        .replace(/\[[!^]?\]?[^\]]*\]/gu, '');
      if (/[|*(]/u.test(body)) return true;
    }
    return wildcards > MAX_SEGMENT_WILDCARDS;
  }
  ```

  Its JSDoc says "more than MAX_SEGMENT_WILDCARDS unbounded wildcards in the
  segment", and the `MAX_SEGMENT_WILDCARDS` JSDoc says "Every unbounded
  wildcard (a run of `*`, or a `+(` group) adds a degree of backtracking".

- `src/core/schema.ts:78`, the refusal text ends with:
  `` and ${String(MAX_SEGMENT_WILDCARDS)} * wildcards per path segment; no |, * or nested group inside *(…) or +(…))` ``
- `CHANGELOG.md`, `## [Unreleased]` → `### Security`, the bullet
  "**A glob pattern can no longer freeze the server.**" says "or that has more
  than three `*` wildcards in one path segment".
- `src/core/file-uri.ts:116-117`:

  ```ts
  // readRaw returns any non-text kind as base64 (`isBinary: kind !== 'text'`).
  if (written.kind !== 'text') return 4 * Math.ceil(size / 3) > MAX_OUTBOUND_RESULT_BYTES;
  ```

  The same function's size-only branch reserves `64 * KIB` for the
  envelope: `6 * size > MAX_OUTBOUND_RESULT_BYTES - 64 * KIB`. `KIB` is a
  local `const KIB = 1024;` at the top of the file.

- `__tests__/glob.test.ts`:
  - `:180` `'+(a)+(b)+(c)+(d)x'` sits in the refuse list of
    `'refuses wildcard shapes whose match backtracks on a long name'`.
  - `:203` `'?(*)?(*)?(*)x'` sits in the accept list of
    `'accepts wildcard shapes that match in bounded time'`. Under the new
    count it is 6 units (3 groups + 3 `*` runs), so it moves to the refuse
    list.
  - `:162` and `:205` `'@(.|)*'` stay accepted (2 units).
- `__tests__/core-fs.test.ts` has the stdio link tests from plans 067/072,
  with `MIB` imported from util and a local `const KIB = 1024;` at `:39`.

## Commands you will need

| Purpose    | Command                                                      | Expected on success |
| ---------- | ------------------------------------------------------------ | ------------------- |
| Install    | `npm ci`                                                     | exit 0              |
| Glob tests | `node --test --test-timeout=60000 __tests__/glob.test.ts`    | all pass            |
| Link tests | `node --test --test-timeout=60000 __tests__/core-fs.test.ts` | all pass            |
| Full check | `npm run check`                                              | exit 0              |

## Scope

**In scope**: `src/core/glob.ts`, `src/core/schema.ts`, `src/core/file-uri.ts`,
`__tests__/glob.test.ts`, `__tests__/core-fs.test.ts`, `CHANGELOG.md`.

**Out of scope**: everything else, including `plans/`.

## Git workflow

- Branch `advisor/073-pr85-second-review` from `47d4e69f`.
- Commits: `fix(glob): count every extglob group toward the wildcard cap`
  and `fix(stdio): reserve the envelope in the binary link check`. Trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do NOT push.

## Steps

### Step 1: Failing glob tests first

In `__tests__/glob.test.ts`:

- Refuse list: add `'?(a|aa)'.repeat(40) + 'b'`, `'@(a|aa)@(a|aa)@(a|aa)@(a|aa)b'`,
  `'?(a)?(b)?(c)?(d)x'` and `'?(*)?(*)?(*)x'`.
- Accept list: remove `'?(*)?(*)?(*)x'`; add `'@(a|aa)@(a|aa)@(a|aa)b'`
  and `'*.@(ts|tsx)'`.

**Verify**: `node --test --test-timeout=60000 __tests__/glob.test.ts` → the
refuse test fails on the `?(a|aa)` chain. If it passes, STOP.

### Step 2: Count every group

Change the loop in `canBacktrack` so every extglob opener counts. `*(`
is already counted by the `*` run regex:

```ts
let wildcards = (segment.match(/\*+/gu) ?? []).length;
for (let i = segment.indexOf('('); i !== -1; i = segment.indexOf('(', i + 1)) {
  const opener = segment[i - 1];
  if (opener === undefined || !'*+?@!'.includes(opener)) continue;
  // Each group can match more than one way, so it adds a degree of
  // backtracking like a `*` run does (`*(` is already counted as one).
  if (opener !== '*') wildcards++;
  if (opener !== '*' && opener !== '+') continue;
  const close = groupClose(segment, i);
  ...unchanged body check...
}
return wildcards > MAX_SEGMENT_WILDCARDS;
```

Update the JSDocs. On `MAX_SEGMENT_WILDCARDS`: "Every run of `*` and every
extglob group (`?(`, `+(`, `@(`, `!(`, `*(`) adds a degree of backtracking:
on a 255-character name three cost under 100 ms, four about 1 s, and five do
not finish; a chain of `?(a|aa)` groups grows the same way." On
`canBacktrack`: replace "more than MAX_SEGMENT_WILDCARDS unbounded wildcards"
with "more than MAX_SEGMENT_WILDCARDS `*` runs and extglob groups together".

**Verify**: glob tests → all pass. Then time the accepted
`@(a|aa)@(a|aa)@(a|aa)b`:
`node -e "const p=require('path');const t=Date.now();p.matchesGlob('a'.repeat(250)+'c','@(a|aa)@(a|aa)@(a|aa)b');console.log(Date.now()-t)"`
→ under 100. Otherwise STOP and report.

### Step 3: Texts

- `src/core/schema.ts:78`: replace
  `${String(MAX_SEGMENT_WILDCARDS)} * wildcards per path segment` with
  `${String(MAX_SEGMENT_WILDCARDS)} * runs and extglob groups together per path segment`.
  Keep the start `Invalid glob or unsafe path (` unchanged.
- `CHANGELOG.md` Security bullet: replace "or that has more than three `*`
  wildcards in one path segment" with "or that has more than three `*` runs
  and extglob groups (`?(…)`, `@(…)`, `!(…)`, `+(…)`, `*(…)`) together in one
  path segment".

**Verify**: `npx prettier --check CHANGELOG.md src/core/schema.ts` → exit 0.
Commit (glob fix).

### Step 4: Binary envelope

In `__tests__/core-fs.test.ts`, near the plan 072 link tests, add a test
`'a binary written file at the base64 edge gets no stdio link'`: call
`writtenFileLinks(path, 'application/octet-stream', size, false, undefined, 'stdio', { content: '', kind: 'binary' })`
with `size = 3 * Math.floor(MAX_OUTBOUND_RESULT_BYTES / 4)` (base64 exactly at
or just under the limit) and expect `resourceUri` undefined. Also expect it
defined for `size = 3 * Math.floor((MAX_OUTBOUND_RESULT_BYTES - 64 * KIB) / 4) - 3`.
Check the `FileKind` values in `src/core/mime.ts`; if `'binary'` is not one of
them, use any non-`'text'` value and say which in the report.

**Verify**: the first assertion fails before the fix.

In `src/core/file-uri.ts`, change the binary branch to reserve the same
envelope margin as the size-only branch:

```ts
if (written.kind !== 'text') {
  return 4 * Math.ceil(size / 3) > MAX_OUTBOUND_RESULT_BYTES - 64 * KIB;
}
```

**Verify**: `node --test --test-timeout=60000 __tests__/core-fs.test.ts
__tests__/outbound-regressions.test.ts` → all pass. Commit.

### Step 5: Full check

**Verify**: `npm run check` → exit 0.

## Done criteria

- [ ] `npm run check` exits 0
- [ ] Steps 1 and 4 failed before their fixes (report the failing assertion)
- [ ] `git diff --stat 47d4e69f..HEAD` lists only in-scope files

## STOP conditions

- The base check prints a diff.
- A step-1 or step-4 assertion passes before its fix.
- An existing accept-list pattern other than `'?(*)?(*)?(*)x'` starts
  failing.
- The step-2 timing check exceeds 100 ms.

## Maintenance notes

- The count is a heuristic upper bound on backtracking degree. A further
  bypass report should first be measured with `path.matchesGlob`; if
  heuristics keep leaking, the structural fix is to match glob names
  in a worker with a hard timeout, or with RE2, which is already a
  dependency.
