# Plan: Give the path guard one owner for access checks, completion directories and the grant boundary

> **Executor rules**: work the steps in order. Run every Verify command and
> confirm its expected result before moving on. On any STOP condition, stop and
> report the condition, the step, and the evidence.
>
> **Written against** commit `f8653ec5`, 2026-10-13.
> **Drift check (run first)**:
> `git diff --stat f8653ec5..HEAD -- src/core/path.ts src/core/path-completer.ts __tests__/path-guard-grant.test.ts __tests__/resources.test.ts CHANGELOG.md`
> Its file list is what narrows the excerpt match: compare
> [Current state](#current-state) against the live code for every file it
> flags. A mismatch is a [STOP](#stop) condition.

## Goal

The path guard has three places where one rule is written twice, and the
copies disagree:

- **Access checks:** sensitivity checking lives in a wrapper that is the
  only caller of `validateAccess`, under a stale comment and a wrong
  section header.
- **Path completion:** completion rebuilds the guard's directory check
  without the device-name and sensitive-file rules. It lists the
  children of a directory whose own name is sensitive, such as
  `vault.key`.
- **Grant boundary:** grants check `FS_ROOT_BOUNDARY` lexically. A missing
  client root spelled through a symlinked boundary is refused, even
  though the same spelling is kept as a startup root (TC-PG-017).

When this lands, each rule has one owner. Completion stops listing inside
sensitive-named directories, and grants follow the startup-root boundary
rule.

Requirements covered: none, this is a refactor with two accepted
behaviour changes. Source: findings 4, 12 and 15 in
[audit findings](assets/audit-findings.md). The two behaviour changes
were accepted in
[T-04](tickets/T-04-behaviour-acceptance.md), and the constraints come
from [T-02](tickets/T-02-behaviour-deltas.md).

## Current state

- [`src/core/path.ts:153-155`](../../../src/core/path.ts#L153-L155): a
  section header with nothing under it. The TOCTOU docstring and the
  `PathGuard` class follow, not Windows helpers:

  ```ts
  // ---------------------------------------------------------------------------
  // Windows helpers
  // ---------------------------------------------------------------------------
  ```

- [`path.ts:415-426`](../../../src/core/path.ts#L415-L426),
  `isWithinBoundary`, the grant boundary check. It compares lexically when
  `realpath` fails, for any reason:

  ```ts
  private async isWithinBoundary(targetDir: string): Promise<boolean> {
    if (this.rootBoundaries.length === 0) {
      return true;
    }
    let resolved: string;
    try {
      resolved = normalizePath(await realpath(targetDir));
    } catch {
      resolved = normalizePath(targetDir);
    }
    return isPathWithinDirectories(resolved, this.rootBoundaries);
  }
  ```

  Its 4-line lead comment (`:411-414`) calls this the "single source of
  truth". Callers: `precheckAccess` (`:356`) and `applyGrant` (`:383`).
- [`path.ts:59-102`](../../../src/core/path.ts#L59-L102):
  `projectRealPath` and `partitionRootsWithin`, the startup-root boundary
  rule. A missing path is projected through its nearest existing
  ancestor; an EACCES-style failure drops the path. Signature:
  `partitionRootsWithin(roots: readonly string[], bounds: readonly string[], signal?: AbortSignal): Promise<{ kept: string[]; dropped: string[] }>`.
  With an empty `bounds`, every root is dropped, so the
  `rootBoundaries.length === 0` early return above **must stay**: T-02
  found 6 tests that break without it (TC-PG-005, 005b and 006,
  GUARD-005, TC-ROOTS-001 and 002).
- [`path.ts:428-442`](../../../src/core/path.ts#L428-L442), the wrapper
  plus a stale comment. No caller awaits `validateAccess`.

  ```ts
  private validateAccessAndSensitivity(requestedPath: string): {
    normalizedRequested: string;
    allowedDirs: string[];
    accessDeniedHint: string;
  } {
    const result = this.validateAccess(requestedPath);
    this.assertNotSensitiveFile(requestedPath, requestedPath);
    this.assertNotSensitiveFile(result.normalizedRequested, requestedPath);
    return result;
  }

  // Synchronous since the access-grant round-trip moved to the executor's
  // pre-check: validateAccess only does lexical containment math and throws,
  // no async I/O remains. Callers still `await` it for uniform control-flow;
  // awaiting a non-thenable returns it unchanged.
  private validateAccess(requestedPath: string): {
  ```

  `validateAccess` ends at
  [`:490-494`](../../../src/core/path.ts#L490-L494) with
  `return { normalizedRequested, allowedDirs: this.allowedDirectoriesState, accessDeniedHint };`.
  The wrapper is called at exactly 3 sites (`:541`, `:706`, `:726`), each
  as `this.validateAccessAndSensitivity(requestedPath);` inside a
  destructuring.
- [`path.ts:117-135`](../../../src/core/path.ts#L117-L135):
  `export async function resolveRealPath(`. Its only caller outside
  `path.ts` is `path-completer.ts`; inside `path.ts` it is used at `:142`.
- [`src/core/path-completer.ts:62-81`](../../../src/core/path-completer.ts#L62-L81):
  `isAllowedCompletionDirectory(path, allowed)` does lexical containment,
  `stat` as a directory, `resolveRealPath`, containment again, and logs a
  debug message on unexpected errors. Its one caller is
  `findMatchesInDirectory(searchDir, prefix, allowed, isSensitive?)`
  ([`:125-163`](../../../src/core/path-completer.ts#L125-L163)), which
  starts with
  `if (!(await isAllowedCompletionDirectory(searchDir, allowed))) return matches;`.
  That function is called only from `suggestPaths`
  ([`:204-206`](../../../src/core/path-completer.ts#L204-L206)) as
  `findMatchesInDirectory(searchDir, prefix, allowed, (p) => pathGuard.isSensitive(p))`.
- `PathGuard.validateExistingDirectory(path)`
  ([`path.ts:574-594`](../../../src/core/path.ts#L574-L594)) owns the
  directory check: it resolves the real path and checks containment,
  drive-relative paths, device names, the sensitive list and is-directory,
  and it **throws** `FsError` on refusal. **Constraint (T-02):** it throws
  where the completer returns false. Unwrapped, the throw reaches
  `suggestPaths`' catch (`:209-214`), which returns `[]` and loses the root
  suggestions. Wrap it so that any refusal is false.
- **Test conventions:**
  - Grant tests: copy TC-PG-017
    ([`__tests__/path-guard-grant.test.ts:303-320`](../../../__tests__/path-guard-grant.test.ts#L303-L320)).
    It uses `mkDir`, `trySymlink`, `process.env['FS_ROOT_BOUNDARY']`
    (restored by the suite's `afterEach`) and
    `withEnv({ FS_ALLOW_MISSING_ROOTS: '1' }, …)`. Symlinks work on this
    host; TC-PG-017 passes rather than skips.
  - Completion tests: copy the client-pair test at
    [`__tests__/resources.test.ts:868-893`](../../../__tests__/resources.test.ts#L868-L893)
    in `describe('filesystem resource path completion')`. It calls
    `harness.client.complete({ ref: { type: 'ref/resource', uri: FILESYSTEM_FILE_URI_TEMPLATE }, argument: { name: 'path', value: encodeFileUriPath(...) } })`,
    and `root` comes from the describe's `before`.
- `*.key` is a default sensitive pattern
  ([`src/core/sensitive.ts:254`](../../../src/core/sensitive.ts#L254)).

## Commands

| Purpose       | Command                                                                                                                                                                         | Expected on success |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Build         | `npm run build`                                                                                                                                                                   | exit 0              |
| Type-check    | `npm run type-check:test`                                                                                                                                                         | exit 0              |
| Guard tests   | `node --test --test-timeout=60000 __tests__/path-guard-grant.test.ts __tests__/aliased-root.test.ts __tests__/guards.test.ts __tests__/roots-seeding.test.ts`                      | `ℹ fail 0`          |
| Completion    | `node --test --test-timeout=60000 __tests__/resources.test.ts`                                                                                                                    | `ℹ fail 0`          |
| Full check    | `npm run check`                                                                                                                                                                   | exit 0              |

Baselines at `f8653ec5`: guard tests `ℹ tests 29`, `ℹ pass 29`;
resources tests `ℹ tests 38`, `ℹ pass 38`.

## Scope

**In scope**: the only files to modify.

- [`src/core/path.ts`](../../../src/core/path.ts)
- [`src/core/path-completer.ts`](../../../src/core/path-completer.ts)
- [`__tests__/path-guard-grant.test.ts`](../../../__tests__/path-guard-grant.test.ts)
- [`__tests__/resources.test.ts`](../../../__tests__/resources.test.ts)
- [`CHANGELOG.md`](../../../CHANGELOG.md)

**Files out of scope**: leave these alone even though they look related.

- [`src/core/sensitive.ts`](../../../src/core/sensitive.ts): the sensitive
  rules do not change; completion only starts using the guard that
  applies them.
- [`src/tools/define.ts`](../../../src/tools/define.ts) and
  [`src/transport/stdio.ts`](../../../src/transport/stdio.ts): they name
  `validateAccess` in comments only, and that name survives.
- [`src/resources.ts`](../../../src/resources.ts): it wires the completer
  and needs no change. It is merge slot 5 (the 2026-10-12 map).

## Steps

### 1. Pin the two behaviour changes with tests (red)

1. In [`__tests__/path-guard-grant.test.ts`](../../../__tests__/path-guard-grant.test.ts),
   inside `describe('PathGuard grant round-trip')` and after TC-PG-017,
   add:

   ```ts
   it('TC-PG-018: applyGrant admits a missing directory spelled through a symlinked FS_ROOT_BOUNDARY', async (t) => {
     // Grants follow the startup-root rule (TC-PG-017): a missing target is
     // projected through its nearest existing ancestor, not compared lexically.
     const target = await mkDir(createdDirs, 'fsmcp-pg018-target-');
     const link = join(root, 'boundary-link');
     const made = await trySymlink(target, link, () => t.skip('symlinks not permitted here'));
     if (!made) return;
     process.env['FS_ROOT_BOUNDARY'] = link;
     const missing = join(link, 'not-yet');
     await withEnv({ FS_ALLOW_MISSING_ROOTS: '1' }, async () => {
       const guard = new PathGuard({ cliAllowedDirs: [target] });
       await guard.recomputeAllowedDirectories();
       assert.strictEqual(await guard.applyGrant(missing), true);
       assert.ok(containsPath(guard.getRoots(), missing), 'the granted directory is a root');
     });
   });
   ```

2. In [`__tests__/resources.test.ts`](../../../__tests__/resources.test.ts),
   inside `describe('filesystem resource path completion')` and after the
   "reports the full match count" test, add two tests. Add `basename` and
   `dirname` to the existing `node:path` import (it imports `join, sep`).

   ```ts
   it('does not list inside a directory whose own name is sensitive', async () => {
     const vault = join(root, 'vault.key');
     await mkdir(vault);
     await writeFile(join(vault, 'inner.txt'), 'x');
     const harness = await createTestClientPair([root]);
     try {
       const result = await harness.client.complete({
         ref: { type: 'ref/resource', uri: FILESYSTEM_FILE_URI_TEMPLATE },
         argument: { name: 'path', value: encodeFileUriPath(`${vault}${sep}`) },
       });
       assert.deepStrictEqual(result.completion.values, []);
     } finally {
       await harness.close();
     }
   });

   it('still suggests roots when the guard refuses the searched directory', async () => {
     const harness = await createTestClientPair([root]);
     try {
       const result = await harness.client.complete({
         ref: { type: 'ref/resource', uri: FILESYSTEM_FILE_URI_TEMPLATE },
         argument: { name: 'path', value: encodeFileUriPath(`${dirname(root)}${sep}`) },
       });
       assert.ok(
         result.completion.values.some((v) => v.includes(basename(root))),
         `root missing from ${JSON.stringify(result.completion.values)}`,
       );
     } finally {
       await harness.close();
     }
   });
   ```

**Verify**:

- Guard tests → `ℹ tests 30`, `ℹ fail 1`. The failing test is TC-PG-018
  (`applyGrant` returns `false`).
- Completion tests → `ℹ tests 40`, `ℹ fail 1`. The failing test is "does
  not list inside a directory whose own name is sensitive"; it currently
  lists `inner.txt`. The root-suggestion test passes.
- Any other failure, or TC-PG-018 being skipped, is a STOP.

### 2. Grant boundary: delegate to the startup-root rule (finding 15)

Replace the body and lead comment of `isWithinBoundary`
([`path.ts:411-426`](../../../src/core/path.ts#L411-L426)) with:

```ts
  // One boundary rule for startup roots and grants: a missing target is
  // projected through its nearest existing ancestor, an unresolvable one is
  // refused. No boundary configured means no constraint; partitionRootsWithin
  // with no bounds would drop everything, so that case returns first.
  private async isWithinBoundary(targetDir: string): Promise<boolean> {
    if (this.rootBoundaries.length === 0) {
      return true;
    }
    const { kept } = await partitionRootsWithin([targetDir], this.rootBoundaries);
    return kept.length > 0;
  }
```

**Verify**: build → exit 0. Guard tests → `ℹ tests 30`, `ℹ fail 0`.

### 3. Access check: fold sensitivity into `validateAccess` (finding 4)

In [`src/core/path.ts`](../../../src/core/path.ts):

1. Delete the 3-line `// Windows helpers` header block (`:153-155`,
   excerpt above).
2. Delete `validateAccessAndSensitivity` and the 4-line comment below it
   (`:428-442`).
3. In `validateAccess`, just before its final `return {`, add:

   ```ts
       this.assertNotSensitiveFile(requestedPath, requestedPath);
       this.assertNotSensitiveFile(normalizedRequested, requestedPath);
   ```

4. Rename the 3 call sites from `this.validateAccessAndSensitivity(` to
   `this.validateAccess(`.

**Verify**:

- `grep -n "validateAccessAndSensitivity\|Windows helpers\|Callers still" src/core/path.ts`
  → no output.
- Build → exit 0.
- Guard tests → `ℹ fail 0`.

### 4. Completion: let the guard decide which directory may be listed (finding 12)

In [`src/core/path-completer.ts`](../../../src/core/path-completer.ts):

1. Delete `isAllowedCompletionDirectory` (`:62-81`).
2. Change `findMatchesInDirectory` to take the guard:
   `async function findMatchesInDirectory(searchDir: string, prefix: string, pathGuard: PathGuard): Promise<string[]>`.
   Replace its first check with:

   ```ts
     // The guard owns what a listing may enter: containment through the real
     // path, device names, the sensitive list, is-a-directory. A refusal is
     // "nothing to list", never an error, so root suggestions survive it.
     const listable = await pathGuard.validateExistingDirectory(searchDir).then(
       () => true,
       () => false,
     );
     if (!listable) return matches;
   ```

   Inside the loop, replace `if (isSensitive?.(fullPath)) continue;` with
   `if (pathGuard.isSensitive(fullPath)) continue;`.
3. In `suggestPaths`:
   - Call `findMatchesInDirectory(searchDir, prefix, pathGuard)`.
   - Delete `const allowed = pathGuard.getAllowedDirectories();` and the
     second sentence of the comment above it ("; the containment set also
     holds …"), since `allowed` has no other use. Confirm first with
     `grep -n "allowed\b" src/core/path-completer.ts`; if `allowed` is
     still read elsewhere in `suggestPaths`, keep the variable.
4. Remove imports that are now unused: `stat` from `node:fs/promises`,
   `resolveRealPath` from `./path.ts`, and `isPathWithinDirectories`
   from `./path-utils.ts` if nothing else uses it. The build reports any
   leftover as `TS6133`. `import type { PathGuard }` stays.
5. In [`src/core/path.ts:117`](../../../src/core/path.ts#L117), change
   `export async function resolveRealPath(` to
   `async function resolveRealPath(`.

**Verify**:

- Build → exit 0, with no `TS6133`.
- `grep -rn "resolveRealPath" src` → only `src/core/path.ts` lines.
- Completion tests → `ℹ tests 40`, `ℹ fail 0`.
- Guard tests (`aliased-root.test.ts` covers completion through an
  aliased root) → `ℹ fail 0`.

### 5. CHANGELOG

Under `## [Unreleased]`, at the end of `### Changed`, add:

```markdown
- **Path completion no longer lists inside a directory the guard refuses,
  and an access grant follows the startup boundary rule.** Completion used
  its own copy of the directory check, so it listed the contents of a
  directory whose own name is sensitive (such as `vault.key`). It now asks
  the guard, and a refusal still returns the matching roots. A client root
  that does not exist yet, spelled through a symlinked `FS_ROOT_BOUNDARY`,
  was refused as a grant although the same spelling is kept as a startup
  root; grants now project it the same way. The sensitive-file check moves
  into the one access check that runs it.
```

**Verify**: `npx prettier --check CHANGELOG.md` → `All matched files use Prettier code style!`

### 6. Format and run the full check

`npx prettier --write src/core/path.ts src/core/path-completer.ts __tests__/path-guard-grant.test.ts __tests__/resources.test.ts CHANGELOG.md`

**Verify**: `npm run check` → exit 0. Record the test summary and
`git diff --numstat -- src`.

## Done

- [ ] `npm run check` exits 0.
- [ ] TC-PG-018 and both new completion tests pass. Each new failing
      test was seen red in step 1.
- [ ] `grep -n "validateAccessAndSensitivity" src/core/path.ts` → no
      output.
- [ ] `grep -n "rootBoundaries.length === 0" src/core/path.ts` → the
      early return is still present in `isWithinBoundary`.
- [ ] `grep -rn "isAllowedCompletionDirectory\|resolveRealPath" src/core/path-completer.ts`
      → no output.
- [ ] `git status --short` lists only the in-scope files plus this
      effort directory.

## STOP

Stop and report if:

- The code at a [Current state](#current-state) location does not match
  its excerpt.
- In step 1, TC-PG-018 passes before step 2 (the finding 15 premise is
  false), or the sensitive-directory test passes before step 4 (the
  finding 12 premise is false). Two audit premises in this effort have
  already failed at delivery; do not change code whose premise did not
  reproduce.
- Any of TC-PG-005, 005b or 006, GUARD-005, or TC-ROOTS-001 or 002 fails
  after step 2. That means the empty-boundary early return was lost.
- The root-suggestion test fails after step 4. That means the guard's
  throw escaped the wrap.
- A step's verification fails twice after one fix attempt.
- The fix appears to require an out-of-scope file.

## Notes

- **What a reviewer should scrutinize:**
  - `validateAccess` now runs the sensitive checks after the containment
    check, the same order the wrapper used. The ordering matters only for
    which error a path that is both out-of-root and sensitive gets:
    ACCESS_DENIED for containment, as before.
  - `precheckAccess` targets always exist, so for them only a
    `realpath` failure on an existing directory now changes the outcome:
    it becomes "not grantable" instead of a lexical comparison.
- **Deferred:** reserved device names in completion are inferred, not
  tested, to already fail at `stat` today (T-02's material uncertainty).
- **Rollback:** revert the PR.
