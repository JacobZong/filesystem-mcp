# Plan 069: `includeHidden` finds dotfiles for a `!(…)` segment again

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8deb0d50..HEAD -- src/core/glob.ts __tests__/glob.test.ts CHANGELOG.md`
> Plan 065 is expected to have changed `glob.ts` (a `canBacktrack` helper and
> `MAX_SEGMENT_WILDCARDS`) and `glob.test.ts`. That is fine. Compare only the
> `dotVariant` excerpt below; a mismatch there is a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW — adds one pattern to the hidden-pattern set for `!(`
  segments only; the walk's containment gate still applies.
- **Depends on**: 065 (same file; land 065 first to avoid conflicts)
- **Category**: bug (regression since `3da494ae`)
- **Planned at**: commit `8deb0d50`, 2026-10-13

## Why this matters

Node's `fs.glob` skips dot-prefixed names unless the matching pattern
segment itself starts with `.`. So for `includeHidden: true`, `glob.ts`
adds dotted variants of the pattern. At `3da494ae` it added `.<segment>`
for any segment. A later refactor routed this through `dotVariant`, which
returns a variant only for a segment starting with `*` or `?`. A negated
extglob `!(…)` now gets none.

Result: `find_files`, `search_text` and `replace_text` with
`pattern: '**/!(*.test).ts', includeHidden: true` silently skip
`sub/.eslintrc.ts`. `pattern: '!(src)'` with `includeHidden: true` returns no
dot entries at all (checked in this repo: 0 of 28). The results look
complete, so nobody notices.

`!(x)` matches any name except `x`, dotfiles included when the caller asked
for them. The dotted variant `.!(x)` matches every dot-prefixed name except
`.x`. That is the old behavior and the right approximation.

## Current state

- `src/core/glob.ts:439-455` (line numbers may shift after plan 065):

  ```ts
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
  ```

  `dotVariant` is called from `addFirstDotSegment` (first non-`**` segment)
  and from `expandHiddenGlobstars` (first segment after `**/`).

- `__tests__/glob.test.ts:665-…` —
  `'includeHidden adds dot-prefixed names only where a leading wildcard can match the dot'`.
  It builds a small tree and uses
  `const hidden = (pattern) => walk({ cwd: root, pattern, includeHidden: true });`
  then `assert.deepStrictEqual(await hidden('…'), [sorted relative paths])`.
  Its tree includes `foo1.txt`, `.foo2.txt`, `sub/foo3.txt`,
  `sub/.foo4.txt`, `.dir/foo5.txt`, `zoo.txt`, `.zoo.txt`, `.oo.txt`,
  `.a.txt`, `src/foox/bar.ts`, `src/.fooy/bar.ts`.
- `isSafeGlobSyntax` accepts `.!(git)` and `**/.!(git|svn|hg)`
  (`__tests__/glob.test.ts:159-160`), so the dotted variant passes
  validation.

## Commands you will need

| Purpose    | Command                                                   | Expected on success |
| ---------- | --------------------------------------------------------- | ------------------- |
| Install    | `npm ci`                                                  | exit 0              |
| Glob tests | `node --test --test-timeout=60000 __tests__/glob.test.ts` | all pass            |
| Full check | `npm run check`                                           | exit 0              |

## Scope

**In scope**: `src/core/glob.ts` (`dotVariant` only), `__tests__/glob.test.ts`,
`CHANGELOG.md`, `plans/README.md` (status row).

**Out of scope**: `addFirstDotSegment`, `expandHiddenGlobstars`,
`buildHiddenPatterns`, the walk loop (plan 070 changes that), `@(…)` and
`?(…)` extglobs (they stay without a variant), `isSafeGlobSyntax`.

## Git workflow

- Branch: `advisor/069-hidden-negated-extglob` (on top of 065's branch if 065
  is not merged yet).
- Message style, e.g. `fix(glob): includeHidden covers a !(…) segment again`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Write the failing test first

In `__tests__/glob.test.ts`, after the test at `:665`, add
`'includeHidden finds dot-prefixed names for a negated extglob segment'`:

```ts
const root = await createTestRoot();
try {
  for (const file of [
    'a.ts',
    'a.test.ts',
    '.eslintrc.ts',
    'sub/.prettierrc.ts',
    'sub/b.test.ts',
    'src/x.ts',
    '.src',
  ]) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), 'x');
  }
  const hidden = (pattern: string): Promise<string[]> =>
    walk({ cwd: root, pattern, includeHidden: true });
  assert.deepStrictEqual(await hidden('**/!(*.test).ts'), [
    '.eslintrc.ts',
    'a.ts',
    'src/x.ts',
    'sub/.prettierrc.ts',
  ]);
  // `.!(src)` is the dotted variant: every dot name except `.src` itself.
  assert.ok((await hidden('!(src)')).includes('.eslintrc.ts'));
} finally {
  await cleanupTestRoot(root);
}
```

Run it before the fix to see it fail.

**Verify**: `node --test --test-timeout=60000 --test-name-pattern="negated extglob" __tests__/glob.test.ts`
→ **fails** (the dot entries are missing). If it passes already, STOP: the
bug is not where this plan says.

### Step 2: Give `!(` a dotted variant

In `dotVariant`, before the `segment[1] === '('` check, add:

```ts
// `!(…)` matches every name but the listed ones, dot names included when
// they are asked for; `.!(…)` is that set's dot-prefixed half. It misses only
// a dot name equal to `.` + a listed one (`.src` for `!(src)`).
if (segment.startsWith('!(')) return `.${segment}`;
```

Update the JSDoc's second sentence to: "Only a leading `*`, `?` or `!(`
stands for that dot: …".

**Verify**: `node --test --test-timeout=60000 __tests__/glob.test.ts` → all
pass, including the new test and the existing `*(z)oo.txt` assertion.

If the first assertion of the new test differs only by `.src` or ordering,
fix the expected list to match the documented behavior (`.src` is not
matched by `**/!(*.test).ts` anyway; it has no `.ts`). Any other difference
is a STOP.

### Step 3: CHANGELOG and full check

Under `## [Unreleased]` (create above `## [2.8.1]` if missing), `### Fixed`:

```markdown
- **`includeHidden` finds dotfiles for a `!(…)` pattern again.** A pattern
  such as `**/!(*.test).ts` with `includeHidden: true` skipped dot-prefixed
  names like `.eslintrc.ts` since 2.8.0.
```

Check the 2.8.0 claim: `git tag --contains $(git log --format=%h -1 -S 'function dotVariant' -- src/core/glob.ts)`
should list `v2.8.0`. If it lists only a later tag, use that version in the
entry.

**Verify**: `npm run check` → exit 0.

## Test plan

- New: `**/!(*.test).ts` and `!(src)` with `includeHidden` include dot
  entries.
- Existing: the "only where a leading wildcard can match the dot" test stays
  green (literal, brace, class, `*(z)` cases unchanged).

## Done criteria

- [ ] `npm run check` exits 0
- [ ] `grep -n "startsWith('!(')" src/core/glob.ts` → 1 match
- [ ] Only in-scope files changed; `plans/README.md` row 069 updated

## STOP conditions

- `dotVariant` no longer matches the excerpt.
- The new test passes before step 2.
- `isSafeGlobSyntax` (after plan 065) refuses `!(*.test).ts`. Report it; 065's
  rule should not count `!(` as a wildcard.

## Maintenance notes

- Plan 070 merges the hidden-pattern walks into one `fs.glob` call; it does
  not change which patterns are built, so this fix carries over.
