# Plan 067: Over stdio, write tools advertise only file links that `resources/read` serves

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8deb0d50..HEAD -- src/core/file-uri.ts src/tools/create.ts src/tools/edit.ts src/tools/patch.ts src/tools/replace-text.ts src/server.ts __tests__/core-fs.test.ts __tests__/outbound-regressions.test.ts CHANGELOG.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — on stdio only, a link is omitted for a written file over
  about 9.75 MiB. HTTP output is unchanged.
- **Depends on**: none. Plan 066 edits a different part of
  `src/tools/replace-text.ts` (the `run` text lines); either order works.
- **Category**: bug
- **Planned at**: commit `8deb0d50`, 2026-10-13

## Why this matters

After a write, `create`, `edit`, `patch` and `replace_text` return a
`resource_link` (and a `resourceUri`) to the file they wrote. The gate is
only "size ≤ the text-file size limit" (10 MiB by default, up to 100 MiB with
`FS_MAX_FILE_SIZE`). Over stdio, `resources/read` refuses any file larger
than `MAX_OUTBOUND_RESULT_BYTES` (10 MiB − 256 KiB), because stdio messages
are capped at 10 MiB. So on stdio, a written file between about 9.75 MiB and
the size limit gets a link that always fails with TOO_LARGE.

`src/server.ts:171` even says "A tool hands out no link that this
connection's resources/read refuses." That holds for result-store links
only, not for file links.

After this plan, on stdio, `writtenFileLinks` also omits the link when the
size is over `MAX_OUTBOUND_RESULT_BYTES`.

## Current state

- `src/core/file-uri.ts:101-124` — `writtenFileLinks`:

  ```ts
  export function writtenFileLinks(
    validPath: string,
    mimeType: string,
    size: number | undefined,
    dryRun = false,
    lastModified?: string,
  ): Pick<WrittenFileMeta, 'resourceUri' | 'resourceLink'> {
    if (dryRun || size === undefined || size > getMaxTextFileSize()) {
      return { resourceUri: undefined, resourceLink: undefined };
    }
    return {
      resourceUri: buildFileResourceUri(validPath),
      resourceLink: buildFileResourceLink(validPath, mimeType, size, lastModified),
    };
  }
  ```

  The JSDoc above it (`:101-109`) lists when no link is given.

- `src/core/file-uri.ts:126-148` — `buildWrittenFileMeta({ validPath, content, dryRun?, lastModified? })`
  calls `writtenFileLinks(validPath, mimeType, size, options.dryRun, options.lastModified)`.
- `src/core/util.ts:166` — `export const MAX_OUTBOUND_RESULT_BYTES = 10 * MIB - 256 * KIB;`
- `src/resources.ts:227-234` — the stdio pre-check that refuses the read:

  ```ts
  const stdio = options.transport === 'stdio';
  if (stdio) {
    const { stats } = await fs.stat(rawPath, { signal: ctx.mcpReq.signal });
    if (stats.size > MAX_OUTBOUND_RESULT_BYTES && stats.size <= getMaxTextFileSize()) {
      throw tooLargeForStdio(stats.size, true);
    }
  }
  ```

- `src/tools/define.ts:42` `export interface ToolCtx`, which has
  `readonly transport?: 'stdio' | 'http' | undefined;` (`:89`, documented as
  "`stdio` alone has a 10 MiB frame limit; `http` on HTTP, unset on the
  in-memory test pair").
- The five call sites. Each already has a `ctx: ToolCtx` in scope:
  - `src/tools/create.ts:298` — `writtenFileLinks(appended.validPath, mimeType, stats?.size, false, stats?.mtime.toISOString())`
  - `src/tools/create.ts:316` — `buildWrittenFileMeta({ validPath: written.validPath, content, lastModified: modified })`
  - `src/tools/edit.ts:392` — `buildWrittenFileMeta({ validPath, content: editResult.content, dryRun: options.dryRun, lastModified: modified })`
  - `src/tools/patch.ts:146` — `buildWrittenFileMeta({ validPath, content: patched, dryRun: args.dryRun, lastModified: ... })`
  - `src/tools/replace-text.ts:585` — `buildWrittenFileMeta({ validPath: summary.primary.path, content: summary.primary.content, dryRun: args.dryRun, lastModified: primaryModified })`
- `src/server.ts:171-173`:

  ```ts
  // A tool hands out no link that this connection's resources/read refuses.
  extraDeps?.transport === 'stdio' ? { maxReadResultBytes: MAX_OUTBOUND_RESULT_BYTES } : {},
  ```

- Tests:
  - `__tests__/core-fs.test.ts:666-724` — unit tests for `buildWrittenFileMeta`
    (TC-FUNC-054) and `writtenFileLinks` ("written file links preserve the
    size boundary, unknown size, and dry-run gates"). Model the new unit test
    on the second one.
  - `__tests__/outbound-regressions.test.ts:23-…` — `describe('outbound result limits')`
    runs a real stdio server (`createStdioClient` from `./helpers.ts`) over a
    root with prepared files. `resourceFile` there is `'line\n'` repeated to
    about 9.9 MiB. Model the integration test on the tests in this file.

## Commands you will need

| Purpose           | Command                                                                   | Expected on success |
| ----------------- | ------------------------------------------------------------------------- | ------------------- |
| Install           | `npm ci`                                                                  | exit 0              |
| Unit tests        | `node --test --test-timeout=60000 __tests__/core-fs.test.ts`              | all pass            |
| stdio tests       | `node --test --test-timeout=60000 __tests__/outbound-regressions.test.ts` | all pass            |
| Contract snapshot | `node --test __tests__/contract.test.ts`                                  | all pass            |
| Full check        | `npm run check`                                                           | exit 0              |

## Scope

**In scope**:

- `src/core/file-uri.ts`
- `src/tools/create.ts`, `src/tools/edit.ts`, `src/tools/patch.ts`,
  `src/tools/replace-text.ts` — the five call sites only, one argument each
- `src/server.ts` — the comment at `:171` only
- `__tests__/core-fs.test.ts`, `__tests__/outbound-regressions.test.ts`
- `CHANGELOG.md`, `plans/README.md` (status row)

**Out of scope**:

- `src/resources.ts` — its refusal is correct; this plan only stops
  advertising links it would refuse.
- The JSON-escaping case: a smaller file full of `"` or `\` can still exceed
  the stdio ceiling once encoded. Not covered here; see Maintenance notes.
- HTTP behavior.
- Any other text in `replace-text.ts` (plan 066 owns the `run` text lines).

## Git workflow

- Branch: `advisor/067-stdio-write-links`
- Message style, e.g. `fix(stdio): advertise only write links resources/read serves`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Gate the link on the transport

In `src/core/file-uri.ts`:

1. Import `MAX_OUTBOUND_RESULT_BYTES` from `./util.ts` next to
   `getMaxTextFileSize` (check the existing import line and extend it).
2. Add a trailing optional parameter `transport?: 'stdio' | 'http'` to
   `writtenFileLinks`, and refuse on stdio past the ceiling:

   ```ts
   export function writtenFileLinks(
     validPath: string,
     mimeType: string,
     size: number | undefined,
     dryRun = false,
     lastModified?: string,
     transport?: 'stdio' | 'http',
   ): Pick<WrittenFileMeta, 'resourceUri' | 'resourceLink'> {
     if (
       dryRun ||
       size === undefined ||
       size > getMaxTextFileSize() ||
       (transport === 'stdio' && size > MAX_OUTBOUND_RESULT_BYTES)
     ) {
       return { resourceUri: undefined, resourceLink: undefined };
     }
     ...
   ```

3. Add one sentence to its JSDoc: "None over stdio past
   `MAX_OUTBOUND_RESULT_BYTES` — stdio's `resources/read` refuses such a
   file before reading it."
4. Add `transport?: 'stdio' | 'http' | undefined;` to the
   `buildWrittenFileMeta` options and pass `options.transport` as the new
   last argument.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0 (the new parameter
is optional, so callers still compile).

### Step 2: Pass the transport at all five call sites

- `create.ts:298`: add `ctx.transport` as the 6th argument of
  `writtenFileLinks(...)`.
- `create.ts:316`, `edit.ts:392`, `patch.ts:146`, `replace-text.ts:585`: add
  `transport: ctx.transport,` to the `buildWrittenFileMeta({...})` object.

If a call site's function receives no `ctx` (the variable name differs),
find the `ToolCtx` value in that function and use it. If there is none,
STOP.

With `exactOptionalPropertyTypes`, passing `transport: ctx.transport` where
the option type includes `| undefined` is fine. If tsc complains, match the
repo's spread idiom: `...(ctx.transport ? { transport: ctx.transport } : {})`.

**Verify**:
`grep -c "transport" src/tools/create.ts src/tools/edit.ts src/tools/patch.ts src/tools/replace-text.ts`
→ each file shows at least 1 more match than before (run the grep before
editing to know the baseline), and `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 3: Fix the server comment

`src/server.ts:171` — change the comment to:
`// A tool hands out no result-store link that this connection's resources/read refuses; file links are gated in writtenFileLinks.`

### Step 4: Unit test

In `__tests__/core-fs.test.ts`, after the "written file links preserve the
size boundary…" test, add `'written file links stop at the stdio ceiling on stdio only'`:

```ts
const path = join(tmpDir, 'stdio-links.txt');
const over = MAX_OUTBOUND_RESULT_BYTES + 1;
assert.deepStrictEqual(writtenFileLinks(path, 'text/plain', over, false, undefined, 'stdio'), {
  resourceUri: undefined,
  resourceLink: undefined,
});
assert.ok(
  writtenFileLinks(path, 'text/plain', MAX_OUTBOUND_RESULT_BYTES, false, undefined, 'stdio')
    .resourceUri,
);
assert.ok(writtenFileLinks(path, 'text/plain', over, false, undefined, 'http').resourceUri);
assert.ok(writtenFileLinks(path, 'text/plain', over).resourceUri);
```

Import `MAX_OUTBOUND_RESULT_BYTES` from `'../src/core/util.ts'` (extend the
existing import from that module if there is one).

**Verify**: `node --test --test-timeout=60000 __tests__/core-fs.test.ts` →
all pass.

### Step 5: stdio integration test

In `__tests__/outbound-regressions.test.ts`, inside
`describe('outbound result limits')`, add
`'an edit over stdio links the file only when resources/read can serve it'`:

1. Write a new file in `root`: `'HEAD\n' + 'line\n'.repeat(Math.floor((9.9 * MIB) / 5))`
   (about 9.9 MiB, over the ceiling, under the 10 MiB size limit), and a
   small file `'HEAD\nline\n'`.
2. Call `edit` on each through the stdio harness with
   `{ path, oldText: 'HEAD', newText: 'HEAD2' }`. Look at how other tests in
   this file call tools through `harness` and match that.
3. Assert the large edit succeeded (`isError` falsy) and its `content` has no
   block with `type === 'resource_link'`.
4. Assert the small edit's `content` has a `resource_link` block.

**Verify**: `node --test --test-timeout=60000 __tests__/outbound-regressions.test.ts`
→ all pass.

### Step 6: CHANGELOG and full check

Under `## [Unreleased]` (create above `## [2.8.1]` if missing), `### Fixed`
(create if missing):

```markdown
- **Write tools over stdio link only files `resources/read` can return.**
  A file written past about 9.75 MiB no longer gets a `resource_link` that
  the stdio connection's `resources/read` always refuses.
```

**Verify**: `npm run check` → exit 0; `node --test __tests__/contract.test.ts`
→ pass with no snapshot change.

## Test plan

- Unit: stdio over ceiling → no link; at ceiling → link; HTTP and unset over
  ceiling → link.
- Integration (real stdio): large edit → no `resource_link`; small edit →
  `resource_link`.
- Existing link tests in `core-fs.test.ts` stay green.

## Done criteria

- [ ] `npm run check` exits 0
- [ ] `grep -n "MAX_OUTBOUND_RESULT_BYTES" src/core/file-uri.ts` → at least 1 match
- [ ] Contract snapshot unchanged
- [ ] Only in-scope files changed; `plans/README.md` row 067 updated

## STOP conditions

- `writtenFileLinks` or any of the five call sites differs from the excerpts.
- A call site has no `ToolCtx` in scope.
- The stdio harness cannot send a ~10 MiB file's edit because of the inbound
  message cap. (`edit` sends only `oldText`/`newText`, so it should not; if it
  does, report.)
- `contract.test.ts` fails.

## Maintenance notes

- Ceiling: the gate uses the file's byte size. A file under the ceiling whose
  JSON encoding exceeds it (many `"`, `\` or control characters) can still get
  a link that `wrapRead` in `src/resources.ts` refuses. Closing that needs
  the encoded size, which `jsonBytesOver(content, MAX_OUTBOUND_RESULT_BYTES)`
  from `src/core/util.ts` can compute in `buildWrittenFileMeta` (it has the
  content). Deferred: rare, and it costs a pass over every written file.
- If stdio ever gains chunked resource reads, drop the stdio branch.
