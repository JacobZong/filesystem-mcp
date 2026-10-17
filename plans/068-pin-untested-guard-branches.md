# Plan 068: Pin four guard branches that no test runs

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8deb0d50..HEAD -- src/resources.ts src/tools/delete.ts src/core/path.ts src/tools/patch.ts __tests__/resources-subscribe.test.ts __tests__/subscriptions-listen.test.ts __tests__/tools.test.ts`
> If any of the four guarded source spots changed, compare them against the
> "Current state" excerpts; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — tests only, no source change.
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `8deb0d50`, 2026-10-13

## Why this matters

Coverage at `8deb0d50` (Windows, `npm run test:coverage`) shows four
security or data-loss guards that no test executes. Each was confirmed
reachable from a client against the built server before this plan was
written. If a refactor drops one of them, the suite stays green:

1. **Subscriptions refuse out-of-root and sensitive files**
   (`src/resources.ts:289-298`). Today only a _missing_ file is tested. If
   the check went away, a client could watch `~/.ssh/...` or `.env` and learn
   when it changes.
2. **Delete refuses an allowed root reached through an alias**
   (`src/tools/delete.ts:126-139`). With roots `a` and `a/b` and a junction
   `a/j → a`, `delete a/j/b` resolves to the root `a/b`. Only this check stops
   a recursive delete of a root.
3. **A missing path under an escaping link answers ACCESS_DENIED, not
   NOT_FOUND** (`src/core/path.ts:440-454`). Otherwise `root/out/<guess>`
   tells a client whether a file exists outside the root.
4. **`patch` refuses a hunk that would duplicate or drop lines**
   (`src/tools/patch.ts:122-128`). It is the backstop against writing a
   corrupt file.

Probe results at `8deb0d50` (Windows, junctions, the in-memory client pair):

| Probe                                                      | Result                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `subscribeResource` on a file outside the root             | rejected, code `-32602` (InvalidParams)                                          |
| `subscribeResource` on `<root>/.env`                       | rejected, code `-32602`                                                          |
| `delete { paths: [a/j/b], recursive: true }`, roots a, a/b | `isError`, text has "Deleting a workspace root"; `a/b/keep.txt` survives         |
| `stat` of `a/out/nope` (junction `a/out → outside`)        | `isError`, result error code `ACCESS_DENIED`                                     |
| `stat` of `a/nope` (control)                               | `isError`, result error code `NOT_FOUND`                                         |
| `patch` on `a\nb\n` with `@@ -10,0 +11,1 @@\n+X\n`         | `isError`, `INVALID_INPUT: patch would duplicate or drop lines…`; file unchanged |

## Current state

The guarded code (do not change it):

- `src/resources.ts:289-298` (inside the subscribe handler):

  ```ts
  if (result.reason === 'invalid-path') {
    const err = result.error;
    if (isNotFoundish(err)) {
      throw new ResourceNotFoundError(uri, `Cannot subscribe to ${uri}: ${err.message}`);
    }
    if (isFsError(err)) throw fsErrorToProtocolError(err);
    ...
  ```

- `src/tools/delete.ts:126`: `if (fs.pathGuard.isAllowedRoot(validPath)) {` →
  failure `Problem.accessDenied('Deleting a workspace root directory is not allowed', …)`.
- `src/core/path.ts:440-454`: on a not-found realpath, resolve the nearest
  existing ancestor; if it is outside the allowed dirs, `throwAccessDenied`.
- `src/tools/patch.ts:122-128`:

  ```ts
  if (countLines(patched) !== countLines(content) + linesAdded - linesRemoved) {
    throw new FsError(
      ErrorCode.INVALID_INPUT,
      'patch would duplicate or drop lines: a hunk overlaps an earlier one or starts past the end of the file',
      args.path,
    );
  }
  ```

Test helpers and exemplars:

- `__tests__/helpers.ts`: `createTestRoot()`, `cleanupTestRoot(dir)`,
  `createTestClientPair(dirs)` (in-memory client + server; `pair.client`,
  `pair.close()`), `trySymlink(target, link, onSkip, type = 'junction')`
  (`:55`; skips when links are not permitted), `waitFor(cond, ms)`,
  `writeTestFile(dir, name, content)`, `firstTextBlock(result)`.
- `__tests__/resources-subscribe.test.ts:21-60` — subscription tests with
  `createTestClientPair`. Its "no notification after unsubscribe" check
  (`setNotificationHandler('notifications/resources/updated', …)` then
  `waitFor(() => received !== undefined, 300)`) is the pattern for "nothing
  was attached".
- `__tests__/subscriptions-listen.test.ts:74-81` — how a rejected
  `client.listen(...)` is asserted:

  ```ts
  await assert.rejects(client.listen({ resourceSubscriptions: [uri] }), (err: unknown) => {
    assert.equal((err as { code?: unknown }).code, ProtocolErrorCode.InvalidParams);
    return true;
  });
  ```

  That file boots HTTP with `bootHttpTest([tmpDir])` and
  `http.makeClient(name)`.

- `__tests__/path-guard-grant.test.ts:206-216` — the `trySymlink(…, () =>
t.skip('symlink creation not permitted'))` skip idiom.
- `__tests__/tools.test.ts:545-558` — TC-FUNC-010b, the literal-root delete
  test. Model test 2 on it.
- `__tests__/tools.test.ts:1745-1810` — existing `patch` tests with inline
  diffs such as `'--- f.txt\n+++ f.txt\n@@ -1,2 +1,2 @@\n-a\n+X\n b\n'`. The
  tool's input field is `diff` (not `patch`).

## Commands you will need

| Purpose    | Command                                                     | Expected on success |
| ---------- | ----------------------------------------------------------- | ------------------- |
| Install    | `npm ci`                                                    | exit 0              |
| One file   | `node --test --test-timeout=60000 __tests__/<file>.test.ts` | all pass            |
| Coverage   | `npm run test:coverage`                                     | exit 0              |
| Full check | `npm run check`                                             | exit 0              |

## Scope

**In scope**:

- `__tests__/resources-subscribe.test.ts`
- `__tests__/subscriptions-listen.test.ts`
- `__tests__/tools.test.ts`
- `plans/README.md` (status row)

**Out of scope**:

- Every file under `src/`. If a test fails because the guard does not work
  as described, that is a bug report, not a fix for this plan.
- New helper files. Use the helpers in `__tests__/helpers.ts`.

## Git workflow

- Branch: `advisor/068-pin-guard-branches`
- Message style, e.g. `test: pin subscribe, aliased-root, escaping-link and patch guards`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Subscribe refuses out-of-root and sensitive files

In `__tests__/resources-subscribe.test.ts`, add a `describe` block with its
own root (so the existing `before` is untouched). Set up:

- `top = await createTestRoot()`, `root = join(top, 'root')`,
  `mkdir(root)`; write `join(top, 'outside.txt')` and `join(root, '.env')`.
- `pair = await createTestClientPair([root])`.

Test `'subscribe refuses a file outside the root and a sensitive file'`:
for each of the two paths, `await assert.rejects(pair.client.subscribeResource({ uri: buildFileResourceUri(p) }), (err) => …code === ProtocolErrorCode.InvalidParams…)`.
Then install a `notifications/resources/updated` handler, `writeFile` both
files, `await waitFor(() => received !== undefined, 300)`, and assert
`received === undefined`.

Import `ProtocolErrorCode` from `'@modelcontextprotocol/server'` and `mkdir`
from `'node:fs/promises'` as needed.

**Verify**: `node --test --test-timeout=60000 __tests__/resources-subscribe.test.ts` → all pass.

### Step 2: Listen refuses the same files (modern era, HTTP)

In `__tests__/subscriptions-listen.test.ts`, inside the describe that uses
`bootHttpTest` and `client.listen` (`:58-…`), add
`'rejects an out-of-root or sensitive resource before acknowledging the listen'`.
The suite's root is `tmpDir`. Write `join(tmpDir, '.env')`; for the
out-of-root file, create one with `createTestRoot()` (a sibling temp dir,
clean it up in a `finally`). Assert each `client.listen({ resourceSubscriptions: [uri] })`
rejects with `ProtocolErrorCode.InvalidParams`, as at `:74-81`.

**Verify**: `node --test --test-timeout=60000 __tests__/subscriptions-listen.test.ts` → all pass.

### Step 3: Delete refuses a root reached through a junction

In `__tests__/tools.test.ts`, next to TC-FUNC-010b (`:545`), add
`'TC-FUNC-010c: deleting an allowed root through an aliasing junction is refused'`
with `async (t) =>`:

1. `top = await createTestRoot()`; `a = join(top, 'a')`, `b = join(a, 'b')`;
   `mkdir(b, { recursive: true })`; write `join(b, 'keep.txt')`.
2. `if (!(await trySymlink(a, join(a, 'j'), () => t.skip('symlink creation not permitted')))) return;`
3. `const pair = await createTestClientPair([a, b]);` (close it and
   `cleanupTestRoot(top)` in `finally`).
4. Call `delete` with `{ paths: [join(a, 'j', 'b')], recursive: true }`.
5. Assert `result.isError === true`, the text matches `/workspace root/i`, and
   `await access(join(b, 'keep.txt'))` resolves.

**Verify**: `node --test --test-timeout=60000 --test-name-pattern="TC-FUNC-010c" __tests__/tools.test.ts` → 1 pass.

### Step 4: A missing path under an escaping junction is ACCESS_DENIED

In `__tests__/tools.test.ts`, near other `stat` tests (search for
`name: 'stat'`), add
`'a missing path under an out-of-root junction answers ACCESS_DENIED, not NOT_FOUND'`
with `async (t) =>`:

1. `top = await createTestRoot()`; `root = join(top, 'root')`,
   `outside = join(top, 'outside')`; `mkdir` both.
2. `trySymlink(outside, join(root, 'out'), …t.skip…)`.
3. `pair = await createTestClientPair([root])`.
4. Call `stat` with `{ path: join(root, 'out', 'nope') }` and with
   `{ path: join(root, 'nope') }`.
5. Assert the first result's text contains `ACCESS_DENIED` and not
   `NOT_FOUND`; the second contains `NOT_FOUND`. (`stat` returns
   `{"results":[{"path":…,"error":{"code":…}}]}` as text; matching the code
   string in the text is enough.)
6. Also call `read` with `{ path: join(root, 'out', 'nope') }` and assert
   `isError` and that the text does not match `/not found/i`.

**Verify**: `node --test --test-timeout=60000 --test-name-pattern="out-of-root junction" __tests__/tools.test.ts` → 1 pass.

### Step 5: `patch` refuses a hunk past the end of the file

In `__tests__/tools.test.ts`, next to the patch tests near `:1745-1810`, add
`'patch refuses a zero-context hunk past the end of the file and writes nothing'`:

- Write `f.txt` with `'a\nb\n'` in the suite's temp dir (match how the
  neighbouring patch tests create their file).
- For each diff in
  `['--- f.txt\n+++ f.txt\n@@ -10,0 +11,1 @@\n+X\n', '--- f.txt\n+++ f.txt\n@@ -3,0 +4,1 @@\n+X\n']`,
  call `patch` with `{ path, diff }` and assert `isError`, text matches
  `/would duplicate or drop lines/u`, and the file still reads `'a\nb\n'`.

**Verify**: `node --test --test-timeout=60000 --test-name-pattern="past the end of the file" __tests__/tools.test.ts` → 1 pass.

### Step 6: Coverage and full check

**Verify**:

- `npm run test:coverage` → exit 0. In its per-file table,
  `src/resources.ts`, `src/tools/delete.ts`, `src/core/path.ts` and
  `src/tools/patch.ts` no longer list `289-298`, `126-139`, `449-454` and
  `122-128` among uncovered lines (line numbers may shift by one or two).
- `npm run check` → exit 0.

## Test plan

Five new tests, listed in steps 1–5. The junction tests skip, not fail,
where links cannot be created (`trySymlink`).

## Done criteria

- [ ] `npm run check` exits 0
- [ ] `npm run test:coverage` exits 0 and the four ranges are covered
- [ ] `git status` shows changes only in the three test files and `plans/README.md`
- [ ] `plans/README.md` row 068 updated

## STOP conditions

- Any new test fails because the server behaves differently from the probe
  table (for example, the aliased delete succeeds, or the out-of-root stat
  says NOT_FOUND). That is a security bug. Report it with the output; do not
  change `src/` or weaken the assertion.
- The guarded excerpts in "Current state" no longer exist.
- A test needs a new helper in `helpers.ts`.

## Maintenance notes

- These tests assert outcomes, not which line refused. If a later refactor
  moves a refusal earlier (for example, `PathGuard` refusing the aliased
  root itself), the tests stay valid; the coverage ranges in step 6 will move.
- The directory-subscription direction item (`plans/README.md`, "Found but
  not planned") would extend `acquire`; step 1–2 tests are its safety net.
