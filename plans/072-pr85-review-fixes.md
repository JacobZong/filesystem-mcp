# Plan 072: Close the three gaps the PR #85 review found

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Base and drift check (run first)**: this plan builds on branch
> `advisor/065-071-integration` at `c8934b96` (PR #85), not on `main`.
> `git fetch origin && git checkout -b advisor/072-pr85-review-fixes c8934b96`
> then `git diff --stat c8934b96..origin/advisor/065-071-integration`. If that
> prints anything, the PR moved: STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW–MED. Fix A refuses a few more glob patterns. Fix B drops
  dotfiles from `!(…)` walks that 069 had added. Fix C omits more stdio links.
- **Depends on**: 065, 067, 069 (all on the PR branch)
- **Category**: security + bug
- **Planned at**: commit `c8934b96`, 2026-10-13

## Why this matters

Review on PR #85 found three defects. The advisor reproduced each one:

1. **Fix A — the glob backtracking refusal can be bypassed.** `canBacktrack`
   in `src/core/glob.ts` finds a repeated group's end with
   `segment.indexOf(')')`. A `)` inside a character class ends the body
   early: `*([)]|?)#` is accepted, but Node parses `|?` inside the repeated
   group. On names made of `)` characters, `path.matchesGlob` took 20 ms at
   20 characters, 271 ms at 24 and 4 193 ms at 28. That is the event-loop
   freeze plan 065 was meant to stop.
2. **Fix B — 069 makes a negation include what it excluded.** For
   `includeHidden`, `dotVariant` turns `!(…)` into `.!(…)`. The extglob then
   sees only the part after the dot. `fs.globSync(['!(.gitignore)', '.!(.gitignore)'])`
   returns `.gitignore`. `replace_text` with `pattern: '!(.env.local)'` and
   `includeHidden: true` would rewrite the file the caller excluded.
   Rewriting the negation correctly for dot names is subtle (`*`-leading
   alternatives such as `*.env` behave differently once a dot is split off).
   The safe fix is to revert 069: a `!(…)` segment gets no dotted variant, so
   hidden names are left out (the 2.8.0 behavior) and never wrongly included.
3. **Fix C — stdio link gate uses raw size.** `writtenFileLinks` (plan 067)
   omits a stdio link only when `size > MAX_OUTBOUND_RESULT_BYTES`. But stdio
   `resources/read` measures the **JSON-encoded result**
   (`jsonBytesOver(result, MAX_OUTBOUND_RESULT_BYTES)` in `wrapRead`). A
   6 MiB file of `"` characters encodes to about 12 MiB, and a file exactly
   at the ceiling goes over once the URI and MIME fields are added. Both still
   get a link that is always refused. A file the reader classifies as binary
   is returned as base64 (4/3 of its size).

## Current state

All on `c8934b96`.

- `src/core/glob.ts:146-164` — `canBacktrack`:

  ```ts
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

- `src/core/glob.ts` — `dotVariant` (search `function dotVariant`), with the
  lines 069 added:

  ```ts
   * did not skip them, or `undefined` when there are none. Only a leading `*`, `?`
   * or `!(` stands for that dot: a literal never does, and a character class or a
  ...
  function dotVariant(segment: string): string | undefined {
    // `!(…)` matches every name but the listed ones, dot names included when
    // they are asked for; `.!(…)` is that set's dot-prefixed half. It misses only
    // a dot name equal to `.` + a listed one (`.src` for `!(src)`).
    if (segment.startsWith('!(')) return `.${segment}`;
    // `*(…)` and `?(…)` are extglobs, not wildcards.
    if (segment[1] === '(') return undefined;
  ```

  Before 069 the JSDoc read "Only a leading `*` or `?` stands for that dot:".
  Once the `!(` line is gone, `segment[1] === '('` returns `undefined` for
  `!(…)` too. Update that comment to "`*(…)`, `?(…)` and `!(…)` are
  extglobs, not wildcards."

- `__tests__/glob.test.ts` — 069's test
  `'includeHidden finds dot-prefixed names for a negated extglob segment'`
  expects `**/!(*.test).ts` to yield `.eslintrc.ts` and
  `sub/.prettierrc.ts`, and `!(src)` to include `.eslintrc.ts`.
  065's tests: `'refuses wildcard shapes whose match backtracks on a long name'`
  and `'accepts wildcard shapes that match in bounded time'`.

- `src/core/file-uri.ts` — `writtenFileLinks(validPath, mimeType, size, dryRun = false, lastModified?, transport?)`
  with the condition
  `(transport === 'stdio' && size > MAX_OUTBOUND_RESULT_BYTES)`, and
  `buildWrittenFileMeta({ validPath, content, dryRun?, lastModified?, transport? })`,
  which has `content` and calls `writtenFileLinks(...)`.
  `src/tools/create.ts` (append branch, about `:298`) calls `writtenFileLinks`
  directly with `stats?.size` and **no content**.
- `src/core/util.ts:187-214` — `jsonByteBound(value)` (cheap upper bound:
  6 bytes per string character) and `jsonBytesOver(value, limit)` (exact
  bytes when over `limit`, else `undefined`; stringifies only when the bound
  cannot clear it). `KIB` and `MAX_OUTBOUND_RESULT_BYTES` live there too.
- `src/resources.ts:236-252` — the stdio read returns
  `{ contents: [{ uri, mimeType, text }] }` for text, or `blob` (base64) for
  binary, and `wrapRead` refuses when `jsonBytesOver(result, MAX_OUTBOUND_RESULT_BYTES)`
  is defined.
- `__tests__/core-fs.test.ts` — 067's test
  `'written file links stop at the stdio ceiling on stdio only'` asserts a
  link **at** `MAX_OUTBOUND_RESULT_BYTES` on stdio. That pins the broken edge.

## Commands you will need

| Purpose    | Command                                                                                             | Expected on success |
| ---------- | --------------------------------------------------------------------------------------------------- | ------------------- |
| Install    | `npm ci`                                                                                            | exit 0              |
| Glob tests | `node --test --test-timeout=60000 __tests__/glob.test.ts`                                           | all pass            |
| Link tests | `node --test --test-timeout=60000 __tests__/core-fs.test.ts __tests__/outbound-regressions.test.ts` | all pass            |
| Full check | `npm run check`                                                                                     | exit 0              |

## Scope

**In scope**: `src/core/glob.ts`, `src/core/file-uri.ts`, `src/tools/create.ts`
(the append call only, if its signature needs it), `__tests__/glob.test.ts`,
`__tests__/core-fs.test.ts`, `CHANGELOG.md`.

**Out of scope**: `src/resources.ts` (its refusal is the reference, not the
bug), `src/core/util.ts` (reuse its helpers; do not add new ones there),
the other write tools (they pass `content` through `buildWrittenFileMeta`
already), `plans/` (the reviewer maintains it).

## Git workflow

- Branch: `advisor/072-pr85-review-fixes` from `c8934b96`.
- One commit per fix: `fix(glob): read past character classes when finding a group's end`,
  `revert(glob): give a negated extglob no dotted variant`,
  `fix(stdio): gate write links on the encoded read size`. Trailer:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do NOT push.

## Steps

### Step 1 (Fix A): Failing tests first

In `'refuses wildcard shapes whose match backtracks on a long name'`, add
`'*([)]|?)#'`, `'+([)]*)x'` and `'*([(]|a)x'` to the refused list. In the
accept list, add `'*([)])x'` (class only, no alternation) and
`'+([()])x'`.

**Verify**: `node --test --test-timeout=60000 __tests__/glob.test.ts` → the
refuse test **fails** on `*([)]|?)#`. If it passes, STOP.

### Step 2 (Fix A): Find the group end past classes

In `src/core/glob.ts`, above `canBacktrack`, add:

```ts
/**
 * Index of the `)` that closes the group opened at `open`, or -1. A `[...]`
 * class is skipped whole: a `)` or `|` inside one is a literal, not syntax.
 */
function groupClose(segment: string, open: number): number {
  let depth = 0;
  for (let i = open; i < segment.length; i++) {
    const c = segment[i];
    if (c === '[') {
      // A `]` first in the class (or after `!`/`^`) is literal, so search past it.
      const first = segment[i + 1] === '!' || segment[i + 1] === '^' ? i + 2 : i + 1;
      const end = segment.indexOf(']', first + 1);
      if (end !== -1) {
        i = end;
        continue;
      }
    }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}
```

In `canBacktrack`, replace the `close` and `body` lines with:

```ts
const close = groupClose(segment, i);
// Classes are literals: only `|`, `*` or a group outside one can backtrack.
const body = segment
  .slice(i + 1, close === -1 ? undefined : close)
  .replace(/\[[!^]?\]?[^\]]*\]/gu, '');
if (/[|*(]/u.test(body)) return true;
```

**Verify**: `node --test --test-timeout=60000 __tests__/glob.test.ts` → all
pass. Then time the new refusals as a sanity check:
`node -e "const p=require('path');const t=Date.now();p.matchesGlob(')'.repeat(24),'+([()])x');console.log(Date.now()-t)"`
→ under 100 (ms). If the accepted `+([()])x` is slow, STOP and report.

Commit.

### Step 3 (Fix B): Revert 069's dotted variant

1. In `dotVariant`, delete the three comment lines and the
   `if (segment.startsWith('!(')) return \`.${segment}\`;` line.
2. Restore the JSDoc sentence to "Only a leading `*` or `?` stands for that
   dot:" and change the comment above `segment[1] === '('` to
   ``// `*(…)`, `?(…)` and `!(…)` are extglobs, not wildcards.``
3. Replace 069's test with
   `'includeHidden never adds dot names a negated extglob excluded'`, same
   tree plus `.gitignore` and `.env.local`:
   - `hidden('!(.gitignore)')` does **not** include `.gitignore`.
   - `hidden('!(.env.local)')` does **not** include `.env.local`.
   - `hidden('**/!(*.test).ts')` equals `['a.ts', 'src/x.ts']` (hidden names
     are left out for a negated segment; this pins the documented limit).
4. In `CHANGELOG.md` under `## [Unreleased]` → `### Fixed`, delete the
   bullet starting `- **\`includeHidden\` finds dotfiles for a \`!(…)\` pattern again.**`.

**Verify**: `node --test --test-timeout=60000 __tests__/glob.test.ts` → all
pass; `grep -c "startsWith('!(')" src/core/glob.ts` → 0.

Commit.

### Step 4 (Fix C): Failing tests first

In `__tests__/core-fs.test.ts`, rewrite `'written file links stop at the
stdio ceiling on stdio only'` so it calls `buildWrittenFileMeta` (which has
the content) and asserts:

- stdio, content `'"'.repeat(6 * MIB)` → `resourceUri` undefined (escapes to about 12 MiB).
- stdio, content `'x'.repeat(MAX_OUTBOUND_RESULT_BYTES)` → undefined (envelope pushes it over).
- stdio, content `'x'.repeat(MAX_OUTBOUND_RESULT_BYTES - 64 * KIB)` → defined.
- http and unset transport, content `'"'.repeat(6 * MIB)` → defined.

Add a second test for the size-only path (the append branch):
`writtenFileLinks(path, 'text/plain', 2 * MIB, false, undefined, 'stdio')` →
undefined, and `writtenFileLinks(path, 'text/plain', 1 * MIB, false, undefined, 'stdio')`
→ defined. Import `MIB`, `KIB` from `'../src/core/util.ts'` as needed.

**Verify**: `node --test --test-timeout=60000 __tests__/core-fs.test.ts` →
the new assertions **fail** (the `'"'` and exact-ceiling cases get links).

### Step 5 (Fix C): Gate on the encoded read

In `src/core/file-uri.ts`:

1. Import `jsonBytesOver` and `KIB` from `./util.ts` (extend the existing
   import).
2. Add a trailing optional parameter `content?: string` to
   `writtenFileLinks`, and replace the stdio clause with a call to this
   helper:

   ```ts
   /**
    * Whether stdio's resources/read would refuse this file: it measures the
    * JSON-encoded result, so escaping counts, and a file it reads as binary
    * comes back base64. Without the content, assume the worst escape (6 bytes
    * per byte) so a link is never one the read refuses.
    */
   function overStdioRead(
     validPath: string,
     mimeType: string,
     size: number,
     written: { content: string; kind: FileKind } | undefined,
   ): boolean {
     if (written === undefined) return 6 * size > MAX_OUTBOUND_RESULT_BYTES - 64 * KIB;
     // readRaw returns any non-text kind as base64 (`isBinary: kind !== 'text'`).
     if (written.kind !== 'text') return 4 * Math.ceil(size / 3) > MAX_OUTBOUND_RESULT_BYTES;
     const result = {
       contents: [{ uri: buildFileResourceUri(validPath), mimeType, text: written.content }],
     };
     return jsonBytesOver(result, MAX_OUTBOUND_RESULT_BYTES) !== undefined;
   }
   ```

   So the trailing parameter of `writtenFileLinks` is
   `written?: { content: string; kind: FileKind }` (not a bare `content`),
   and the condition becomes
   `(transport === 'stdio' && overStdioRead(validPath, mimeType, size, written))`.
   `FileKind` is already imported in this file.

3. In `buildWrittenFileMeta`, it already computes `kind` from
   `detectMimeFromContent`; pass `{ content, kind }` as the new last argument.
   `src/resources.ts` / `src/core/fs.ts:476` classify with the same MIME
   detection (`isBinary: mimeInfo.kind !== 'text'`). If the executor finds
   `readRaw` uses a different detector than `detectMimeFromContent`, STOP.
4. Update the `writtenFileLinks` JSDoc sentence about stdio to: "None over
   stdio when the read would refuse it: the JSON-encoded result past
   `MAX_OUTBOUND_RESULT_BYTES` (escaping counts, binary is base64), or, with
   no content to measure, any file whose worst-case escape could be."
5. `src/tools/create.ts` append branch: no change needed (it passes no
   content, so the worst-case rule applies). Leave it.

**Verify**: `node --test --test-timeout=60000 __tests__/core-fs.test.ts __tests__/outbound-regressions.test.ts`
→ all pass (067's stdio integration test still sees no link on the 9.9 MiB
edit and a link on the small one).

Commit.

### Step 6: CHANGELOG wording and full check

In `CHANGELOG.md`, change the 067 bullet's second sentence to: "A written
file whose `resources/read` result would exceed the stdio message limit once
JSON-encoded no longer gets a `resource_link` that the read always refuses."
Leave the 065 Security bullet as is.

**Verify**: `npm run check` → exit 0; `node --test __tests__/contract.test.ts`
→ pass, no snapshot change.

## Done criteria

- [ ] `npm run check` exits 0 on `advisor/072-pr85-review-fixes`
- [ ] Steps 1 and 4 failed before their fix (state it in the report)
- [ ] `grep -c "startsWith('!(')" src/core/glob.ts` → 0
- [ ] `git diff --stat c8934b96..HEAD` lists only in-scope files

## STOP conditions

- The base check at the top prints a diff.
- Step 1 or step 4's new assertions pass before the fix.
- An accept-list pattern in `glob.test.ts` starts failing after step 2.
- 067's stdio integration test in `outbound-regressions.test.ts` fails after step 5.

## Maintenance notes

- `groupClose` handles classes and nesting only. A backslash escape inside a
  pattern is not parsed (on Windows `\` is a separator here). If a POSIX
  escape such as `\)` ever matters, extend `groupClose`; until then such a
  pattern is refused or accepted conservatively by the star count.
- Dotfiles for a negated extglob stay a documented limit. A correct dotted
  rewrite has to drop non-dot literal alternatives, strip the dot from dot
  alternatives, and keep `*`-leading ones only when they cannot match a
  dot-leading tail. Do it only with property tests against
  `fs.globSync` semantics.
