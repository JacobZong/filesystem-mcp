Status: clean

# Plan hunt: Route every read through `GuardedFileSystem` so no read path skips the H4 re-check

Hunted [`read-path-h4.plan.md`](read-path-h4.plan.md) at `1bc6b791`,
2026-10-13.

## Confirmed

none

## Suspected

none

## Coverage

- **Drift check:** ran; no files changed since `1bc6b791`.
- **Current state:** every excerpt was re-opened at its `file:line`.
  Recon had found two references off by a few lines (`fs.ts` `stat`,
  `read.ts` `await using`); both were corrected before this hunt.
- **Commands table:** every command was run once.
  - `npm run build` and `npm run type-check:test` exit 0.
  - The targeted tests give `tests 62, pass 60, skipped 2, fail 0`.
  - The search and tools tests give `tests 139, pass 138, skipped 1,
    fail 0`.
  - `npm run check` was not run during the hunt; step 7 runs it.
- **Step 1:** the branch name is free; `git` is present.
- **Step 2:**
  - `createTestClientPair`, `searchContent` and the fs helpers are
    already imported in `__tests__/high-severity-fixes.test.ts:9-25`.
  - `SearchContentOptions.explicitFile` exists (`src/core/search.ts:218`).
  - The `read` tool's `paths` allows one entry (`.min(1)`,
    `src/core/schema.ts:147`).
  - One candidate was sent to a blind refuter and **killed**: the claim
    that `rm(dir)` on a symlink to a directory throws and stalls the
    flipper. The repo already does this at
    `__tests__/mutation-regressions.test.ts:283-295`, and the refuter saw
    it work on Node 24.15.0 using a junction.
- **Step 3:**
  - `ToolCtx.fs` is typed as the full `GuardedFileSystem`
    (`src/tools/define.ts:46`), so the new `known` parameter needs no
    interface change.
  - `ReadSpec` members all carry `signal?: AbortSignal`
    (`src/core/read.ts:63-67`), so passing a `ReadSpec` to `this.stat`
    type-checks.
  - No test mocks `readLeadingSample` or `countFileLines`.
  - `countFileLines` has 6 call sites in `core-fs.test.ts`; the count was
    corrected in recon.
- **Step 4:**
  - No module in `src/core` imports `search.ts`, so importing `./fs.ts`
    there adds no cycle.
  - `FileHandle.readFile` accepts `signal` (`@types/node`
    `fs/promises.d.ts:339`).
- **Steps 5-8, Scope, Done and STOP:** checked against every dead-step
  tell; no dead step found.
- **Not run:** the Linux race tests. Node is not installed in this
  host's WSL, so the CI `ubuntu-latest` leg is the gate, as step 8 and
  Done state.
