Status: clean

# Plan hunt: Give the path guard one owner for access checks, completion directories and the grant boundary

Hunted [`guard-batch.plan.md`](guard-batch.plan.md) at `f8653ec5`,
2026-10-13.

## Confirmed

none

## Suspected

none

## Coverage

- **Drift check:** HEAD is the commit the plan was written against.
- **Current state:** every cited `file:line` was re-opened with `grep -n`.
  Ten references were off by 1 to 7 lines in the first draft (the
  `isWithinBoundary` comment and body, the `validateAccess` return,
  `findMatchesInDirectory`, the `suggestPaths` call and catch, the
  TC-PG-017 and completion test ranges, `*.key` in `sensitive.ts`). All
  were corrected before this hunt; the excerpts themselves matched.
- **Commands:** the build, `type-check:test`, the guard tests (29/29) and
  the resources tests (38/38) were all run at `f8653ec5`. TC-PG-017 runs
  rather than skips here, so symlinks are available for TC-PG-018.
- **Step 1:**
  - `createTestClientPair`, `FILESYSTEM_FILE_URI_TEMPLATE`,
    `encodeFileUriPath`, `mkdir` and `writeFile` are already imported in
    `resources.test.ts`. `basename` and `dirname` are not, and the step
    adds them.
  - `mkDir`, `trySymlink`, `withEnv` and `containsPath` exist in
    `path-guard-grant.test.ts`.
  - Red is expected before the fixes. TC-PG-018 fails because the
    lexical comparison misses the symlinked boundary. The sensitive-dir
    test fails because `isAllowedCompletionDirectory` never consults the
    sensitive list. The root-suggestion test passes before and after,
    because `findMatchingRoots` compares `dirname(root)` to `searchDir`.
- **Step 2:** `partitionRootsWithin` is a module function in the same
  file and needs no import. The early return is kept, which is the T-02
  constraint.
- **Step 3:** the wrapper has exactly 3 callers (`:541`, `:706`, `:726`).
  The comments naming `validateAccess` in `define.ts` and `stdio.ts`
  stay true.
- **Step 4:**
  - `matches` is declared before the check that the step replaces.
  - `isPathWithinDirectories` and `stat` are used only inside the
    deleted function.
  - `isSkippableErrno` and `Logger` stay in use.
  - `resolveRealPath` keeps its in-file caller at `:142`.
- **Steps 5-6, Done and STOP:** each STOP names a risk specific to this
  change: a premise that does not reproduce, the lost early return, and
  the escaped throw.
- **Refuter:** no candidate survived the step 2 checks, so none was sent.
