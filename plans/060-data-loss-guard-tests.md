# Plan 060: The reachable data-loss guards in `move`, `delete` and `PathGuard.applyGrant` are pinned by tests

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3da494ae..HEAD -- src/tools/move.ts src/tools/delete.ts src/core/path.ts src/core/input-required.ts __tests__/helpers.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW. Test-only.
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `3da494ae`, 2026-10-12

## Why this matters

Several branches that keep `move`, `delete` and access grants from losing
data or widening the sandbox **are never executed by any test**. A coverage
run at `3da494ae` reports them as uncovered. A refactor that drops one of
these checks passes the full suite today. This plan pins the ones a test can
reach:

| Guard                                                                           | Code                                                    |
| ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `move`: two batch entries with one destination → refuse the second              | `src/tools/move.ts:294-318`                             |
| `PathGuard.applyGrant`: recompute throws → grant rolled back                    | `src/core/path.ts:392-398`                              |
| `move`: destination created while the human confirms → nothing moves            | confirmation binding (R9), `src/core/input-required.ts` |
| `delete`: target vanished while the human confirms → `NOT_FOUND`, no errno text | `src/tools/delete.ts` re-plan                           |

**What planning found about the "confirmation gap" checks.** The
`input_required` flow re-runs the whole tool handler on the retry round: it
re-validates, re-stats and re-plans, from scratch. The identity check in
`delete.ts:199-219` and the "destination created during confirmation" check
in `move.ts:210-222` therefore compare the retry round's own plan with the
moment just before mutation (microseconds apart). They do not compare it with
what the human was shown. A client-side test cannot reach them, so this plan
does **not** try. Planning confirmed the observable behaviour with a scratch
test against `3da494ae` (Windows, Node 24.15):

- `move`, where a second destination appears during confirmation: the
  retry's pending set no longer matches the sealed one. The whole call fails
  with `INVALID_INPUT: move: confirmation does not match the requested paths`,
  and nothing moves. **Safe. Pinned by GUARD-001.**
- `delete`, where the target vanishes during confirmation:
  `NOT_FOUND "Path not found"`, `failed: 1`. **Pinned by GUARD-004.**
- `delete`, where the confirmed directory is replaced by a file, or by a
  different non-empty directory, during confirmation: **the replacement is
  deleted and reported `deleted: true`.** That is a product question (should
  a confirmation bind to the object, not only the path?), so it is **not
  pinned here**. The advisor reported it to the maintainer separately. Do
  not write a test that asserts either behaviour.

## Current state

- `src/tools/move.ts:294-318`, the batch duplicate-destination refusal:

```ts
const seenDest = new Set<string>();
const ready: TransferPlan[] = [];
for (const candidate of candidates) {
  const destKey = normalizeCaseForComparison(candidate.validDest);
  if (seenDest.has(destKey)) {
    failures.push(
      pairFailure(
        candidate.pair,
        new FsError(
          ErrorCode.INVALID_INPUT,
          `${VERB[op]} cancelled: another entry in this batch already targets destination "${candidate.pair.destination}"`,
          candidate.pair.destination,
        ),
      ),
    );
    continue;
  }
  seenDest.add(destKey);
  ready.push(candidate);
}
```

Observed at planning for `moves: [s1→d, s2→d]` with no confirmation: `d`
holds s1's content, s2 still exists, and `_meta.failures[0].error.message`
contains `already targets destination`.

- `src/core/path.ts:375-409`, `applyGrant`. After `isUnsafeGrantTarget` and
  `isWithinBoundary`, under a lock:

```ts
const previous = this.grantedDirectories;
this.grantedDirectories = [...previous, normalizePath(targetDir)];
try {
  await this.recomputeAllowedDirectories();
} catch (error) {
  // A failed recompute leaves the guard with its previous, consistent view.
  this.grantedDirectories = previous;
  throw error;
}
```

`recomputeAllowedDirectories` is a public instance method, called as
`this.recomputeAllowedDirectories()`, so a test can replace it on one
instance.

- `src/tools/delete.ts:294-317`. Only **recursive, non-empty directories**
  are "pending" and need confirmation. Choices are `['delete', 'skip']`. The
  sealed `requestState` holds the pending path set, and the retry recomputes
  it from the same arguments.

- **Exemplars to copy:**
  - `__tests__/tools.test.ts:411-436` `TC-FUNC-009q`. It mutates the
    filesystem inside the elicitation handler, then returns `accept`:

```ts
it('TC-FUNC-009q: a file that appears during the confirmation gap is not overwritten', async () => {
  const gapFile = join(tmpDir, 'create_gap_appears.txt');
  const eh = await createElicitationClientPair([tmpDir], async () => {
    await writeFile(gapFile, 'written during the gap\n');
    return { action: 'accept' as const, content: { choice: 'overwrite' } };
  });
  try {
    ...
    assert.strictEqual(result.isError, true, 'fails closed');
    assert.strictEqual(await readFile(gapFile, 'utf-8'), 'written during the gap\n');
  } finally {
    await eh.close();
  }
});
```

- `__tests__/tools.test.ts:2151-2176` `TC-FUNC-069`. A delete via the
  choice round-trip, reading `result._meta` as
  `{ results?: { path?, value?: { deleted? }, error? }[]; summary?: { failed? } }`.
- `__tests__/path-guard-grant.test.ts:84-106` `TC-PG-003`. A direct
  `PathGuard`: `new PathGuard({ cliAllowedDirs: [root] })` plus
  `await guard.recomputeAllowedDirectories()`, with grant targets from
  `mkdtemp(join(tmpdir(), prefix))`.
- Helpers (`__tests__/helpers.ts`): `createTestRoot`, `cleanupTestRoot`,
  `createTestClientPair`, `createElicitationClientPair(allowedDirs, handler)`,
  `withEnv`, `writeTestFile`.

## Commands you will need

| Purpose         | Command                                | Expected on success |
| --------------- | -------------------------------------- | ------------------- |
| New file only   | `npm test -- __tests__/guards.test.ts` | `fail 0`            |
| Typecheck tests | `npm run type-check:test`              | exit 0              |
| Lint            | `npm run lint`                         | exit 0              |
| Full check      | `npm run check`                        | exit 0              |

Baseline at planning time: 586 tests, 582 pass, 4 skipped (Windows), 0 fail.

## Scope

**In scope**:

- `__tests__/guards.test.ts`: new. Use a new file, not `tools.test.ts`
  (3540 lines), so this plan does not conflict with other work in that file.
- `plans/README.md`: status row

**Out of scope**:

- Any `src/**` change, including the stale "confirmation gap" comments in
  `delete.ts:180-183,200-204` and `move.ts:210-211`. They are part of the
  product question reported separately.
- Tests asserting what happens when a confirmed directory is **swapped**
  during confirmation (see "Why this matters").
- `src/tools/delete.ts:125-138` (the workspace-root refusal after
  `validatePathForDelete`). `path.ts:734` refuses every allowed root first.
- `src/core/path.ts:399-407` (a grant dropped by the recompute). It needs the
  boundary to change mid-call.
- `src/tools/move.ts:500-508` (the protected-entry walk failing closed). Node
  24's `fs.glob` swallows `readdir` errors (an unreadable directory lists as
  empty), so the walk never throws for a permission problem and a test cannot
  reach this branch. Already recorded in `plans/README.md`. Do not stub
  `globEntries`.

## Git workflow

- Branch: `advisor/060-data-loss-guard-tests`
- One commit, e.g. `test(guards): pin move batch, grant-rollback and confirmation guards`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: File skeleton

Create `__tests__/guards.test.ts` with `describe('Data-loss guards', …)`,
whose `before`/`after` create and remove a test root (`createTestRoot` /
`cleanupTestRoot`). Use separate sub-roots or unique file names per test.
Import only what you use. The import-sort plugin and ESLint enforce order and
unused imports.

**Verify**: `npm run lint` → exit 0.

### Step 2: `move` batch and confirmation guards

**GUARD-001: a destination that appears during confirmation makes the whole
move fail closed.**

- `srcA` holds `'A'`; `destA` **exists** with `'oldA'` (this forces
  confirmation). `srcB` holds `'B'`; `destB` does **not** exist.
- `let calls = 0;` then
  `createElicitationClientPair([root], async () => { calls += 1; await writeFile(destB, 'gap'); return { action: 'accept' as const, content: { choice: 'overwrite' } }; })`
- Call `move` with `moves: [{source: srcA, destination: destA}, {source: srcB, destination: destB}]`.
- Assert: `calls === 1` (one confirmation round); `result.isError === true`;
  `assert.match(firstTextBlock(result).text ?? '', /confirmation does not match the requested paths/)`
  (import `firstTextBlock` from `./helpers.ts`); `destB` is `'gap'`;
  `destA` is `'oldA'`; `srcA` and `srcB` both still exist. Nothing moved.

**GUARD-002: two copy entries with one destination; only the first lands.**
Use `createTestClientPair([root])` (no confirmation needed):

- `s1` holds `'one'`, `s2` holds `'two'`, and `d` does not exist. Call `move`
  with `copy: true` and `moves: [{source: s1, destination: d}, {source: s2, destination: d}]`.
- Assert: `d` is `'one'`; both sources still exist;
  `assert.match(JSON.stringify(result._meta), /already targets destination/)`.

**GUARD-002b**: the same without `copy` (a real move). Assert `d` is `'one'`,
`s1` is gone, `s2` still exists with `'two'`, and the message is present.

**Verify**: `npm test -- __tests__/guards.test.ts` → 3 pass. Then a mutation
spot-check: temporarily change `if (seenDest.has(destKey))` in
`src/tools/move.ts` to `if (false)`. GUARD-002 and 002b must fail. Revert with
`git checkout -- src/tools/move.ts`.

### Step 3: `delete`, target vanished during confirmation

**GUARD-004.** Create `dir` containing `a.txt`
(`await writeTestFile(dir, 'a.txt', 'x')`). `dir` is the target, a non-empty
directory, so confirmation is needed. With `let calls = 0;`, the handler does
`calls += 1`, runs `rm(dir, { recursive: true })`, then returns
`{ action: 'accept', content: { choice: 'delete' } }`. Call `delete` with
`{ paths: [dir], recursive: true }`.

- Assert: `calls === 1`; `_meta.summary.failed === 1`; `_meta.results[0].error.code === 'NOT_FOUND'`;
  `JSON.stringify(result)` matches `/Path not found/` and does **not** match
  `/ENOENT|lstat/`. The errno text must stay off the wire.

**GUARD-004b**: the same with `ignoreIfNotExists: true`. Assert
`_meta.summary.failed === 0`. If the call instead reports a failure, STOP and
report the result object. It is a behaviour question, so do not adjust the
assertion to match.

**Verify**: `npm test -- __tests__/guards.test.ts` → 2 more pass.

### Step 4: `PathGuard.applyGrant` rollback

**GUARD-005: a grant whose recompute throws leaves the allowed set unchanged.**

```ts
await withEnv({ FS_ROOT_BOUNDARY: undefined }, async () => {
  const guard = new PathGuard({ cliAllowedDirs: [root] });
  await guard.recomputeAllowedDirectories();
  const before = guard.getAllowedDirectories();
  const outside = await mkdtemp(join(tmpdir(), 'fsmcp-guard005-'));
  try {
    const original = guard.recomputeAllowedDirectories.bind(guard);
    guard.recomputeAllowedDirectories = () => Promise.reject(new Error('recompute failed'));
    await assert.rejects(guard.applyGrant(outside), /recompute failed/);
    guard.recomputeAllowedDirectories = original;
    await guard.recomputeAllowedDirectories();
    assert.deepStrictEqual(
      guard.getAllowedDirectories(),
      before,
      'a rolled-back grant must not reappear',
    );
  } finally {
    await cleanupTestRoot(outside);
  }
});
```

The final recompute with the original method is what proves
`grantedDirectories` was restored. Without the rollback, it would add
`outside`.

**Verify**: it passes. Then temporarily delete the line
`this.grantedDirectories = previous;` inside the `catch` in
`src/core/path.ts` (about line 396). GUARD-005 must **fail**. Revert with
`git checkout -- src/core/path.ts`.

### Step 5: Full check

Run `npx prettier --write __tests__/guards.test.ts`, then
`npx prettier --check __tests__/guards.test.ts` → exit 0.

**Verify**: `npm test -- __tests__/guards.test.ts` → `pass 6`, `fail 0`,
`skipped 0`. `npm run check` → exit 0. `git diff main...HEAD -- src/` is
empty.

## Test plan

New file `__tests__/guards.test.ts`:

- GUARD-001: move, destination appears during confirmation → whole call fails closed.
- GUARD-002 / 002b: copy and move, two entries with one destination.
- GUARD-004 / 004b: delete, target vanished during confirmation, without and with `ignoreIfNotExists`.
- GUARD-005: `applyGrant` rollback when the recompute throws.

Patterns: `TC-FUNC-009q` (mutation in the handler), `TC-FUNC-069` (delete
`_meta` shape), `TC-PG-003` (direct `PathGuard`).

## Done criteria

- [ ] `__tests__/guards.test.ts` exists with exactly GUARD-001, 002, 002b, 004, 004b, 005
- [ ] `npm test -- __tests__/guards.test.ts` → `fail 0`
- [ ] The step 2 and step 4 mutations were observed to fail; `git diff main...HEAD -- src/` is empty
- [ ] `grep -c "swap\|replaced by" __tests__/guards.test.ts` → `0` (do not mention swaps in comments either)
- [ ] `npm run check` exits 0
- [ ] `plans/README.md` row updated

## STOP conditions

Stop and report back (do not improvise) if:

- GUARD-001 moves anything (`destB` is not `'gap'`, or a source is gone). That
  is a data-loss bug.
- GUARD-002's `d` ends up holding `'two'`, or `s2` is gone after the real move.
- GUARD-004 leaks `ENOENT` or `lstat` text, or GUARD-004b reports a failure.
- The elicitation handler is never called in GUARD-001 or GUARD-004, which
  means no confirmation round happened. The precondition is wrong for the
  current code, so report the result object.
- `PathGuard.recomputeAllowedDirectories` cannot be replaced on an instance.

## Maintenance notes

- The tests pin messages by fragment (`confirmation does not match the
requested paths`, `already targets destination`, `Path not found`). A rewording updates the regex in the same
  change.
- If the maintainer decides a confirmation must bind to the object (for
  example sealing `dev`/`ino`/`birthtimeMs` into the `requestState`), the
  product change should add the swap tests this plan deliberately leaves out.
  GUARD-001 and GUARD-004 should keep passing unchanged.
- If a future Node version makes `fs.glob` surface `readdir` errors, the
  `move.ts:500-508` walk branch becomes reachable with an unreadable
  subdirectory (POSIX, non-root). Add the test then.
