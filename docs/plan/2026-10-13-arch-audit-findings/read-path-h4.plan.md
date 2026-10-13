# Plan: Route every read through `GuardedFileSystem` so no read path skips the H4 re-check

> **Executor rules**: work the steps in order. Run every Verify command and
> confirm its expected result before moving on. On any STOP condition, stop and
> report the condition, the step, and the evidence.
>
> **Written against** commit `1bc6b791`, 2026-10-13.
> **Drift check (run first)**:
> `git diff --stat 1bc6b791..HEAD -- src/core/fs.ts src/core/read.ts src/core/search.ts src/tools/read.ts src/tools/create.ts __tests__/core-fs.test.ts __tests__/high-severity-fixes.test.ts CHANGELOG.md`
> Its file list is what narrows the excerpt match: compare
> [Current state](#current-state) against the live code for every file it
> flags. A mismatch is a [STOP](#stop) condition.

## Goal

The guard promises that reads "open with O_NOFOLLOW (final component) and
re-check the fd's real path on Linux (ancestor swap)"
([`path.ts:157-164`](../../../src/core/path.ts#L157-L164)). Four read paths
skip part of that:

- `search_text`'s `scanFile` reads by name with plain `readFile`. It leaks
  file content from outside the roots on every OS.
- `read`'s batch (known-stats) branch skips the fd re-check.
- The append path's `readLeadingSample` skips the fd re-check.
- The append path's `countFileLines` skips both validation and the fd
  re-check.

On Linux the last three leak through an ancestor-directory swap. Only a
local process that can write inside a root can exploit any of them.

When this lands, every read opens through `GuardedFileSystem`, and
`readFileWithStats` can no longer be called without a handle check. It
also takes `readLeadingSample`'s never-varying `size` parameter (finding 9
of the 2026-10-12 audit).

Requirements covered: none, this is a fix. Scope source:
[audit findings](assets/audit-findings.md) finding 1, as widened by
[T-03](tickets/T-03-security-fix-first.md). Facts:
[T-01](tickets/T-01-h4-bypass-facts.md).

## Current state

- [`src/core/fs.ts`](../../../src/core/fs.ts) is the `GuardedFileSystem`
  front door. Its guarded open, at
  [`fs.ts:459-470`](../../../src/core/fs.ts#L459-L470), is the pattern
  every read must go through:

  ```ts
  async open(filePath: string): Promise<FileHandle> {
    const validPath = await this.pathGuard.validateExistingPath(filePath);
    const handle = await fsOpen(validPath, READ_NOFOLLOW);
    try {
      await this.#assertFdWithinRoots(handle, filePath);
    } catch (error) {
      await handle.close();
      throw error;
    }
    return handle;
  }
  ```

- [`fs.ts:384-391`](../../../src/core/fs.ts#L384-L391) is the guarded
  `readFile`; the batch branch must reach this instead of bypassing it:

  ```ts
  async readFile(filePath: string, spec: ReadSpec): Promise<ReadFileResult> {
    spec.signal?.throwIfAborted();
    const validPath = await this.pathGuard.validateExistingPath(filePath);
    const stats = await withAbort(fsStat(validPath), spec.signal);
    return readFileWithStats(filePath, validPath, stats, spec, (handle) =>
      this.#assertFdWithinRoots(handle, filePath),
    );
  }
  ```

- [`fs.ts:350-360`](../../../src/core/fs.ts#L350-L360) `readLeadingSample`
  opens by itself and never calls `#assertFdWithinRoots`:

  ```ts
  async readLeadingSample(filePath: string, size: number): Promise<Buffer> {
    const { validPath } = await this.stat(filePath);
    const handle = await fsOpen(validPath, READ_NOFOLLOW);
    try {
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }
  ```

- [`fs.ts:76-110`](../../../src/core/fs.ts#L76-L110): `CHAR_LF`,
  `LINE_COUNT_CHUNK_BYTES` and the exported free function `countFileLines`.
  It opens with `fsOpen(filePath, READ_NOFOLLOW)` at
  [`fs.ts:90`](../../../src/core/fs.ts#L90), with no validation and no fd
  check. Its body (the chunk loop, then
  `return totalBytes === 0 ? 0 : lastByte === CHAR_LF ? newlines : newlines + 1;`)
  moves unchanged.
- [`src/core/read.ts:531-552`](../../../src/core/read.ts#L531-L552)
  `readFileWithStats` takes an **optional** `verifyHandle`, so a caller can
  skip the check:

  ```ts
  export async function readFileWithStats(
    filePath: string,
    validPath: string,
    stats: Stats,
    spec: ReadSpec,
    verifyHandle?: (handle: FileHandle) => Promise<void>,
  ): Promise<ReadFileResult> {
    ...
    await using handle = await openReadableFileHandle(validPath, spec.signal);
    await verifyHandle?.(handle);
  ```

  `fs.ts` imports it ([`fs.ts:43`](../../../src/core/fs.ts#L43)), so it
  stays exported; making the parameter required is what closes the
  bypass. Its callers are `fs.ts:388`, `fs.ts:408` (both pass a check)
  and `tools/read.ts:322` (passes none).
- [`src/tools/read.ts:320-322`](../../../src/tools/read.ts#L320-L322), the
  bypass. Import at
  [`read.ts:14`](../../../src/tools/read.ts#L14):
  `import { readFileWithStats } from '../core/read.ts';`

  ```ts
  const spec = buildReadSpec(args, ctx.signal);
  const result = known
    ? await readFileWithStats(filePath, known.validPath, known.stats, spec)
    : await ctx.fs.readFile(filePath, spec);
  ```

  `known` is set only for a `paths` batch entry whose stat succeeded and
  that fits the budget ([`read.ts:186-232`](../../../src/tools/read.ts#L186-L232)).
- [`src/core/search.ts:258-289`](../../../src/core/search.ts#L258-L289)
  `ScanContext` holds `pathGuard: PathGuard`. `scanFile` validates, throws
  the result away, then reads by name:

  ```ts
  async function scanFile(entryPath: string, scanCtx: ScanContext): Promise<FileScan> {
    try {
      await scanCtx.pathGuard.validateExistingPath(entryPath);
    } catch {
      return { kind: 'inaccessible' };
    }

    try {
      const stats = await fsStat(entryPath);
      if (stats.size > scanCtx.maxFileSize) return { kind: 'tooLarge' };
    } catch {
      return { kind: 'inaccessible' };
    }

    let buffer: Buffer;
    try {
      buffer = await readFile(entryPath, { signal: scanCtx.signal });
    } catch (error) {
      if (scanCtx.signal?.aborted) throw error;
      return { kind: 'inaccessible' };
    }
  ```

  Import at [`search.ts:1`](../../../src/core/search.ts#L1):
  `import { stat as fsStat, readFile } from 'node:fs/promises';`
  (used nowhere else in the file; confirm with
  `grep -n "fsStat\|readFile" src/core/search.ts`). `scanCtx` is built at
  [`search.ts:396-397`](../../../src/core/search.ts#L396-L397) with
  `pathGuard,`. `searchContent(directory, pattern, options, pathGuard)` keeps
  its signature: 7 test call sites pass a `PathGuard`.
- [`src/tools/create.ts:16,23,280,284`](../../../src/tools/create.ts#L276-L285),
  the append result. It imports `countFileLines` from `../core/fs.ts` and
  `MIME_SAMPLE_SIZE` from `../core/mime.ts`, and calls
  `ctx.fs.readLeadingSample(appended.validPath, MIME_SAMPLE_SIZE)` and
  `countFileLines(appended.validPath)`.
- `MIME_SAMPLE_SIZE = 512` lives at
  [`mime.ts:117`](../../../src/core/mime.ts#L117). `fs.ts` already imports
  `detectMimeFromContent` from `./mime.ts`.
- **Conventions:**
  - Handle lifetime: `await using handle = ...`, as in
    [`read.ts:545`](../../../src/core/read.ts#L545).
  - Race tests: copy the flipper in
    [`high-severity-fixes.test.ts:349-409`](../../../__tests__/high-severity-fixes.test.ts#L349-L409).
    It loops 400 times, swallows refusal errors, and asserts outside the
    `try`.
  - CHANGELOG: bold one-sentence lead, then prose, under `## [Unreleased]`
    → `### Security`, as in
    [`CHANGELOG.md:10-24`](../../../CHANGELOG.md#L10-L24).
- **Platform fact:** `#assertFdWithinRoots`
  ([`fs.ts:127-148`](../../../src/core/fs.ts#L127-L148)) reads
  `/proc/self/fd`; it is a no-op off Linux. O_NOFOLLOW is 0 on Windows
  ([`read.ts:18-23`](../../../src/core/read.ts#L18-L23)). This dev machine
  is Windows with no Node in WSL, so the race tests skip locally and run
  only on CI's `ubuntu-latest` leg
  ([`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)).

## Commands

| Purpose          | Command                                                                                             | Expected on success                       |
| ---------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Build            | `npm run build`                                                                                     | exit 0, no output after the npm notices   |
| Typecheck tests  | `npm run type-check:test`                                                                           | exit 0                                    |
| Targeted tests   | `node --test --test-timeout=60000 __tests__/high-severity-fixes.test.ts __tests__/core-fs.test.ts`  | summary `ℹ fail 0`                        |
| Search + tools   | `node --test --test-timeout=60000 __tests__/tools.test.ts __tests__/sandbox.test.ts`                | summary `ℹ fail 0`                        |
| Full check       | `npm run check`                                                                                     | exit 0                                    |

Baseline at `1bc6b791` for the targeted tests: `ℹ tests 62`, `ℹ pass 60`,
`ℹ skipped 2`, `ℹ fail 0`.

## Scope

**In scope**: the only files to modify.

- [`src/core/fs.ts`](../../../src/core/fs.ts)
- [`src/core/read.ts`](../../../src/core/read.ts)
- [`src/core/search.ts`](../../../src/core/search.ts)
- [`src/tools/read.ts`](../../../src/tools/read.ts)
- [`src/tools/create.ts`](../../../src/tools/create.ts)
- [`__tests__/core-fs.test.ts`](../../../__tests__/core-fs.test.ts)
- [`__tests__/high-severity-fixes.test.ts`](../../../__tests__/high-severity-fixes.test.ts)
- [`CHANGELOG.md`](../../../CHANGELOG.md)

**Files out of scope**: leave these alone even though they look related.

- [`src/tools/search-text.ts`](../../../src/tools/search-text.ts):
  `searchContent` keeps its `PathGuard` parameter, so the caller does not
  change.
- `searchFiles` and `guardedEntries` in
  [`src/core/search.ts`](../../../src/core/search.ts): they list names and
  read no bytes. `guardedEntries` is finding 6 of the 2026-10-12 map.
- [`src/core/path.ts`](../../../src/core/path.ts): the guard itself is
  correct, and findings 4, 12 and 15 of this map touch it in other PRs.
- `package.json`, `server.json`, `mcpb/manifest.json`: versions are bumped
  only by the Release workflow (`AGENTS.md`).
- `__tests__/contract.test.ts.snapshot`: no advertised surface changes.

## Steps

### 1. Create the branch

`git switch -c fix/read-path-h4-bypass`

**Verify**: `git branch --show-current` → `fix/read-path-h4-bypass`

### 2. Add the search and batch-read regression tests

These compile against today's API. They fail only on Linux, and only
probabilistically, so locally they are recorded as skipped.

In [`__tests__/high-severity-fixes.test.ts`](../../../__tests__/high-severity-fixes.test.ts),
inside the `describe('H4: …')` block at
[`:327`](../../../__tests__/high-severity-fixes.test.ts#L327):

1. **Add a client pair.** Declare
   `let pair: Awaited<ReturnType<typeof createTestClientPair>>;` beside
   `let fs`. At the end of its `before`, add
   `pair = await createTestClientPair([root]);`. At the start of its
   `after`, add `await pair.close();`. `createTestClientPair` is already
   imported.
2. **Pin `scanFile` in the existing final-component flipper**
   ([`:349`](../../../__tests__/high-severity-fixes.test.ts#L349)). Inside
   its `for` loop, after the `textContent` block, add:

   ```ts
   let searched: Awaited<ReturnType<typeof searchContent>> | undefined;
   try {
     searched = await searchContent(root, 'TOP_SECRET', { explicitFile: victim }, ctx.pathGuard);
   } catch {
     /* refusals are fine */
   }
   if (searched !== undefined) {
     assert.strictEqual(searched.matches.length, 0, 'a search must never match the secret');
   }
   ```

3. **Add a new test after the flipper `it`** (before the "legitimate
   in-root symlink" `it`):

   ```ts
   it('an ancestor directory swapped for a symlink never leaks through any read path', async (t) => {
     // #assertFdWithinRoots reads /proc/self/fd, so only Linux re-checks an
     // ancestor; elsewhere this swap is the residual path.ts's TOCTOU note names.
     if (process.platform !== 'linux') return t.skip('fd re-check is Linux-only');
     const outsideDir = join(base, 'outside-dir');
     await mkdir(outsideDir, { recursive: true });
     await writeFile(join(outsideDir, 'victim.txt'), 'TOP_SECRET\n'.repeat(5));
     const dir = join(root, 'swapdir');
     const parked = join(root, 'swapdir.real');
     await mkdir(dir, { recursive: true });
     const victim = join(dir, 'victim.txt');
     await writeFile(victim, 'in-root\n');

     // Each op in its own try, so a lost race heals on the next lap instead
     // of wedging the flip: dir is the real directory, then a symlink to
     // outsideDir, then the real directory again.
     const step = async (op: () => Promise<unknown>): Promise<void> => {
       try {
         await op();
       } catch {
         /* races are expected */
       }
     };
     let stop = false;
     const flipper = (async () => {
       while (!stop) {
         await step(() => rename(dir, parked));
         await step(() => symlink(outsideDir, dir));
         await step(() => rm(dir));
         await step(() => rename(parked, dir));
       }
     })();

     try {
       for (let i = 0; i < 400; i++) {
         let searched: Awaited<ReturnType<typeof searchContent>> | undefined;
         try {
           searched = await searchContent(root, 'TOP_SECRET', { explicitFile: victim }, ctx.pathGuard);
         } catch {
           /* refusals are fine */
         }
         if (searched !== undefined) {
           assert.strictEqual(searched.matches.length, 0, 'a search must never match the secret');
         }
         const batch = await pair.client.callTool({
           name: 'read',
           arguments: { paths: [victim] },
         });
         assert.ok(
           !JSON.stringify(batch).includes('TOP_SECRET'),
           'a batch read must never return the secret',
         );
       }
     } finally {
       stop = true;
       await flipper;
     }
   });
   ```

**Verify**:
`node --test --test-timeout=60000 __tests__/high-severity-fixes.test.ts __tests__/core-fs.test.ts`
→ `ℹ tests 63`, `ℹ fail 0`, `ℹ skipped 3` (on Windows the new test is
skipped and the flipper is skipped as before).

### 3. Route the batch read, the leading sample and the line count through the guard

Make these changes in one step, so the build stays green.

1. [`src/core/read.ts:536`](../../../src/core/read.ts#L536): make the
   handle check required. Change it to
   `verifyHandle: (handle: FileHandle) => Promise<void>,`, and at
   [`:546`](../../../src/core/read.ts#L546) change the call to
   `await verifyHandle(handle);`.
2. [`src/core/fs.ts`](../../../src/core/fs.ts) `readFile`: add an optional
   third parameter that skips the re-validation when the caller already
   stat'd the path through this guard:

   ```ts
   async readFile(
     filePath: string,
     spec: ReadSpec,
     known?: { validPath: string; stats: Stats },
   ): Promise<ReadFileResult> {
     spec.signal?.throwIfAborted();
     const { validPath, stats } = known ?? (await this.stat(filePath, spec));
     return readFileWithStats(filePath, validPath, stats, spec, (handle) =>
       this.#assertFdWithinRoots(handle, filePath),
     );
   }
   ```

   `this.stat` ([`fs.ts:160-167`](../../../src/core/fs.ts#L160-L167)) is
   the same `validateExistingPath` plus `withAbort(fsStat(validPath),
   signal)` pair that `readFile` inlines today; `spec` carries an optional
   `signal`.
3. `fs.ts` `readLeadingSample`: drop `size`, open through the guard, and
   add `MIME_SAMPLE_SIZE` to the existing `./mime.ts` import:

   ```ts
   async readLeadingSample(filePath: string): Promise<Buffer> {
     await using handle = await this.open(filePath);
     const buffer = Buffer.alloc(MIME_SAMPLE_SIZE);
     const { bytesRead } = await handle.read(buffer, 0, MIME_SAMPLE_SIZE, 0);
     return buffer.subarray(0, bytesRead);
   }
   ```

4. `fs.ts` `countFileLines`: delete the exported free function
   ([`fs.ts:80-110`](../../../src/core/fs.ts#L80-L110), keeping its doc
   comment) and re-add it as a `GuardedFileSystem` method, placed after
   `readLeadingSample`:
   - Signature: `async countFileLines(filePath: string): Promise<number>`.
   - Its first line is `await using handle = await this.open(filePath);`.
   - The chunk loop and the return expression move unchanged.
   - The `try`/`finally` that closed the handle goes away.
   - `CHAR_LF` and `LINE_COUNT_CHUNK_BYTES` stay at module level.
5. [`src/tools/read.ts`](../../../src/tools/read.ts): delete the import at
   `:14`, and replace `:321-322` with
   `const result = await ctx.fs.readFile(filePath, spec, known);`.
6. [`src/tools/create.ts`](../../../src/tools/create.ts):
   - `:16`: import `{ destExists, type Stats }` (drop `countFileLines`).
   - `:280`: `const sample = await ctx.fs.readLeadingSample(appended.validPath);`
   - `:284`: `lineCount = await ctx.fs.countFileLines(appended.validPath);`
   - Drop `MIME_SAMPLE_SIZE` from the `:23` import if
     `grep -n MIME_SAMPLE_SIZE src/tools/create.ts` then shows no other use.
7. [`__tests__/core-fs.test.ts`](../../../__tests__/core-fs.test.ts):
   - `:11` becomes `import { GuardedFileSystem } from '../src/core/fs.ts';`.
   - Each `await countFileLines(` (6 sites, `:436,442,455,562,565,574`)
     becomes `await fs.countFileLines(`. `fs` is the suite's
     `GuardedFileSystem` over `tmpDir`
     ([`:30-35`](../../../__tests__/core-fs.test.ts#L30-L35)), and every
     file these tests count is written under `tmpDir`.

**Verify**:

- `npm run build` → exit 0.
- `npm run type-check:test` → exit 0.
- `grep -rn "readFileWithStats" src` → exactly 4 lines: the definition in
  `src/core/read.ts`, and the import plus 2 calls in `src/core/fs.ts`.
  None in `src/tools`.
- `grep -rn "countFileLines" src` → only the method in `src/core/fs.ts`
  and `ctx.fs.countFileLines` in `src/tools/create.ts`.
- The targeted tests → `ℹ fail 0`.

### 4. Read through the guard in `scanFile`

In [`src/core/search.ts`](../../../src/core/search.ts):

1. Delete the `node:fs/promises` import at `:1`. Add
   `import { GuardedFileSystem } from './fs.ts';`. It is a value import:
   `searchContent` constructs it. `fs.ts` imports nothing from `search.ts`,
   so this adds no cycle.
2. In `ScanContext`, replace `pathGuard: PathGuard;` with
   `fs: GuardedFileSystem;`. In the `scanCtx` literal, replace `pathGuard,`
   with `fs: new GuardedFileSystem(pathGuard),`. `PathGuard` stays
   imported; `searchContent`'s signature and other functions still use
   it.
3. Replace the first three `try` blocks of `scanFile` (validate, stat,
   read) with one block:

   ```ts
   let buffer: Buffer;
   try {
     // open() validates, refuses a swapped final symlink (O_NOFOLLOW) and
     // re-checks the descriptor's real path (H4), so these bytes are the
     // validated file's, not whatever the name points at by now.
     await using handle = await scanCtx.fs.open(entryPath);
     const stats = await handle.stat();
     if (stats.size > scanCtx.maxFileSize) return { kind: 'tooLarge' };
     buffer = await handle.readFile({ signal: scanCtx.signal });
   } catch (error) {
     if (scanCtx.signal?.aborted) throw error;
     return { kind: 'inaccessible' };
   }
   ```

   Everything from the NUL-byte check onward is unchanged.

**Verify**:

- `npm run build` → exit 0.
- `grep -n "node:fs" src/core/search.ts` → no output.
- The targeted tests → `ℹ fail 0`.
- Search + tools tests
  (`node --test --test-timeout=60000 __tests__/tools.test.ts __tests__/sandbox.test.ts`)
  → `ℹ fail 0`.

### 5. Extend the ancestor-swap test to the append metadata reads

In the step-2 test's `for` loop, after the batch-read assertion, add:

```ts
let sample: Buffer | undefined;
try {
  sample = await fs.readLeadingSample(victim);
} catch {
  /* refusals are fine */
}
if (sample !== undefined) {
  assert.ok(!sample.toString('utf-8').includes('TOP_SECRET'), 'a MIME sample must never come from the secret');
}
let lines: number | undefined;
try {
  lines = await fs.countFileLines(victim);
} catch {
  /* refusals are fine */
}
if (lines !== undefined) {
  assert.notStrictEqual(lines, 5, 'a line count must never describe the secret');
}
```

The secret has 5 lines and the in-root victim has 1, so a count of 5 can
only come from the outside file.

**Verify**: `npm run type-check:test` → exit 0. The targeted tests →
`ℹ tests 63`, `ℹ fail 0`.

### 6. Add the CHANGELOG entry

In [`CHANGELOG.md`](../../../CHANGELOG.md), under `## [Unreleased]` →
`### Security`, add a bullet after the existing ones, in their style:

```markdown
- **A path swapped for a symlink mid-read can no longer leak content
  through `search_text`, batch `read`, or an append's result.** `search_text`
  read each file by name after validating it, so a symlink swapped in
  between returned matches from a file outside the allowed folders on every
  platform. A batch `read`, and the MIME type and line count an append
  reports, skipped the Linux check that the opened file still sits inside
  the allowed folders, so swapping a parent folder for a symlink leaked
  them there. Every read now opens through the same guarded path, which
  refuses a swapped final symlink and, on Linux, re-checks the opened
  file's real location. Exploiting this took a local process able to write
  inside an allowed folder.
```

**Verify**: `npx prettier --check CHANGELOG.md` → `All matched files use Prettier code style!`

### 7. Format, then run the full check

`npm run check` runs `prettier --check .`, so first format the edited files:
`npx prettier --write src/core/fs.ts src/core/read.ts src/core/search.ts src/tools/read.ts src/tools/create.ts __tests__/core-fs.test.ts __tests__/high-severity-fixes.test.ts CHANGELOG.md`

**Verify**: `npm run check` → exit 0. Record its test summary line.

### 8. Hand back for commit, push and Linux CI

Commits, pushes and merges need the user's go-ahead (map Notes). Stop and
report:

- `git diff --stat`;
- the net line delta of `src/`, from `git diff --numstat -- src`;
- the `npm run check` summary.

The race tests run only on CI's `ubuntu-latest` leg. That leg passing on
the PR is the Linux gate.

## Done

Machine-checkable. All must hold:

- [ ] `npm run check` exits 0.
- [ ] The targeted tests show `ℹ tests 63` and `ℹ fail 0`, including
      "an ancestor directory swapped for a symlink never leaks through any
      read path".
- [ ] `grep -rn "readFileWithStats" src/tools` → no output.
- [ ] `grep -n "verifyHandle?" src/core/read.ts` → no output.
- [ ] `grep -n "node:fs" src/core/search.ts` → no output.
- [ ] `grep -rn "readLeadingSample(.*," src` → no output (the size
      parameter is gone).
- [ ] `git status --short` lists only the in-scope files plus this plan's
      effort directory.
- [ ] After the user approves a push: CI's `Check (ubuntu-latest)` job is
      green on the PR.

## STOP

Stop and report if:

- The code at a [Current state](#current-state) location does not match
  its excerpt.
- A step's verification fails twice after one fix attempt. A second
  failure means the step's assumption is wrong, not its implementation.
- The fix appears to require an out-of-scope file, in particular
  `src/tools/search-text.ts` or any change to `searchContent`'s signature.
- `GuardedFileSystem.open` refuses a path that today's `scanFile` searched
  (any search test in `tools.test.ts` or `core-fs.test.ts` loses matches).
  The plan assumes `open`'s guard equals `validateExistingPath` plus the
  descriptor check, and nothing stricter.
- Importing `./fs.ts` into `search.ts` creates an import cycle (`npm run
  check:static`, through knip or the build, reports one).
- On CI's Linux leg, the ancestor-swap test fails. That means a path still
  leaks; do not loosen the assertion.

## Notes

- **What a reviewer should scrutinize:**
  - `readFile`'s `known` parameter trusts the caller's `validPath`. Its
    only caller passes the result of `ctx.fs.stat` on the same
    `GuardedFileSystem`, and the descriptor re-check still runs, so a
    stale `known` cannot escape on Linux.
  - In `scanFile`, a guard refusal and a read failure now both count as
    `skippedInaccessible`, as they did before.
- **Deferred:**
  - A swap to a FIFO between validation and open can block `scanFile`'s
    open. Today's `readFile(entryPath)` blocks the same way, so this plan
    does not make it worse. Fixing it means `O_NONBLOCK` on reads, which
    is out of scope here.
  - The 2026-10-12 map's
    [core singles batch](../2026-10-12-arch-audit-findings/tickets/T-05-core-singles-batch.md)
    still lists its finding 9. This plan delivers that finding, so that
    batch narrows to findings 1 and 6.
- **Rollback:** revert the PR. No data or migrations are involved.
