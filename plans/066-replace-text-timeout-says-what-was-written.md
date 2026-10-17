# Plan 066: A `replace_text` timeout says which files it already rewrote

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8deb0d50..HEAD -- src/tools/replace-text.ts __tests__/tools.test.ts docs/configuration.md docs/client-guide.md CHANGELOG.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW — one extra text line on one result shape, plus docs.
- **Depends on**: none
- **Category**: bug (model-facing output) + docs
- **Planned at**: commit `8deb0d50`, 2026-10-13

## Why this matters

`replace_text` rewrites files as it scans them, under the same 5 s deadline
that `search_text` uses. When the deadline hits during a real (non-dry) run,
the files already rewritten stay rewritten and the rest are untouched. The
text the model sees today ends with:

```text
// scan stopped early: hit the time limit, or the request was cancelled. That total is a floor, not the count. Narrow path or pattern for the rest.
```

It never says that files were written. "Narrow path or pattern for the
rest" invites the model to run the same replacement again. When the
replacement still matches its own pattern (`foo` → `foobar`), a second run
applies it twice to the files the first run changed. The changed paths
ship only under `_meta`, which clients do not show the model.

The docs also miss this. `docs/configuration.md` says only "`list`, `stat`,
and search tools" time out. `docs/client-guide.md` names `list`, `stat`,
`find_files` and `search_text`. The code also gives `read` and
`replace_text` the 5 s deadline.

After this plan, a timed-out non-dry run names how many files it rewrote
and which ones (first five), and warns against re-running blindly. The docs
list every tool that has the deadline.

Making `replace_text` all-or-nothing (plan everything first, then write) is
a larger change and is **not** this plan.

## Current state

- `src/tools/replace-text.ts` — the `replace_text` tool.
  - `:283-320` `processEntry`: under `lockForWrite`, it plans and writes one
    file, then counts it (`summary.filesChanged++`,
    `recordChangedFile(summary, plan, entryPath)`). A write that fails is not
    counted.
  - `:102` `const REPLACE_CONCURRENCY = Math.min(PARALLEL_CONCURRENCY, 8);`
  - `:604` `timeoutMs: DEFAULT_SEARCH_TIMEOUT_MS,`
  - `:613-670` `run`, which builds the text lines. The stop line today:

    ```ts
    const lines = [summaryText];
    const stop = structured.stoppedReason;
    if (stop === 'timeout') lines.push(stoppedEarlyLine(stop));
    else if (stop !== undefined) {
      // maxResults/maxFiles here are the caller's own caps, so raising one is
      // what reaches the rest; the search engine's advice to narrow is not.
      lines.push(
        `// scan stopped early: hit the ${stop} limit; later files were not scanned. A higher ${stop} reaches them.`,
      );
    }
    ```

  - Later in `run` (`:651-655`) is the convention for listing rows in the
    text: at most three, full relative path:

    ```ts
    for (const r of structured.results.filter((x) => 'error' in x).slice(0, 3)) {
      lines.push(`// ${r.path}: ${r.error.code} ${r.error.message}`);
    }
    ```

  - `structured.results` holds changed files as
    `{ path, value: { matches } }` and failures as `{ path, error }`
    (`:462`). `structured.summary.succeeded` is the changed-file count
    (`:471`). `args.dryRun` is the dry-run flag.
- `src/core/fmt.ts:143-146` `stoppedEarlyLine` — shared with `search_text`
  and `find_files`. **Do not change it.**
- `__tests__/tools.test.ts:3928-3953` — "H1: a live replace_text timeout
  never writes a partially spliced file". It forces a timeout by mocking
  `AbortSignal.timeout`:

  ```ts
  t.mock.method(AbortSignal, 'timeout', () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('test timeout', 'TimeoutError')), 100);
    return controller.signal;
  });
  ```

  It lives in `describe('High-severity bug-hunt regressions (tools)')`
  (`:3704`), which sets up `pair = await createTestClientPair([tmpDir])`.

- `src/core/fs.ts:80` `export class GuardedFileSystem`, with
  `async writeFile(` at `:205`.
- `docs/configuration.md:203` — limits table row:
  `| \`list\`, \`stat\`, and search tools | Time out after about 5 seconds; narrow the path or pattern |`
- `docs/client-guide.md:362-366`:

  ```markdown
  - `list` and `stat` stop themselves after about 5 seconds with a `TIMEOUT`
    error. `find_files` and `search_text` stop at the same deadline but return
    what they found so far, with `_meta.stoppedReason: 'timeout'` (see
    [Pagination](#pagination-and-cached-results)). `maxResults` does not
    shorten a scan; a narrower `path`, `pattern`, or `maxDepth` does.
  ```

## Commands you will need

| Purpose           | Command                                                                                               | Expected on success |
| ----------------- | ----------------------------------------------------------------------------------------------------- | ------------------- |
| Install           | `npm ci`                                                                                              | exit 0              |
| Focused tests     | `node --test --test-timeout=60000 --test-name-pattern="replace_text timeout" __tests__/tools.test.ts` | all pass            |
| Contract snapshot | `node --test __tests__/contract.test.ts`                                                              | all pass            |
| Full check        | `npm run check`                                                                                       | exit 0              |

Run tests with no `FS_*` environment variables set.

## Scope

**In scope**:

- `src/tools/replace-text.ts` (the `run` text lines only)
- `__tests__/tools.test.ts` (one new test)
- `docs/configuration.md`, `docs/client-guide.md`
- `CHANGELOG.md`
- `plans/README.md` (status row only)

**Out of scope**:

- `src/core/fmt.ts` `stoppedEarlyLine` — shared by other tools.
- The write path (`processEntry`, `lockForWrite`, `processEntriesConcurrently`)
  and the deadline value. No behavior change to what gets written.
- `structuredContent` / `_meta` shape — the contract snapshot pins it.

## Git workflow

- Branch: `advisor/066-replace-text-timeout-text`
- Message style, e.g. `fix(replace_text): say which files a timeout already rewrote`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Add the "already rewritten" line

In `run` in `src/tools/replace-text.ts`, right after the existing
`if (stop === 'timeout') lines.push(stoppedEarlyLine(stop));` branch (keep
that line), add:

```ts
// A live run writes as it scans, so a timeout leaves the files it reached
// rewritten. The paths ship under `_meta`, which the model does not see; name
// them here, or a re-run of a self-matching replacement applies it twice.
if (stop === 'timeout' && !args.dryRun && structured.summary.succeeded > 0) {
  const changed = structured.results.filter((x) => !('error' in x)).map((x) => x.path);
  const shown = changed.slice(0, 5).join(', ');
  const more = changed.length > 5 ? `, and ${String(changed.length - 5)} more` : '';
  lines.push(
    `// ${String(structured.summary.succeeded)} file(s) were already rewritten and stay changed: ${shown}${more}. ` +
      'Re-running the same replacement applies it to them again; exclude them, or use dryRun first.',
  );
}
```

If `structured.results` items do not type-check with `'error' in x`
narrowing in the `filter`, use the same style as the existing failure loop
(`structured.results.filter((x) => 'error' in x)`) inverted. Do not add a
type cast.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 2: Test it

In `__tests__/tools.test.ts`, inside the `describe` that holds the H1
replace test (`:3885` block, or the enclosing
`describe('High-severity bug-hunt regressions (tools)')`), add a test named
`'a live replace_text timeout names the files it already rewrote'`, with
`{ timeout: 10000 }`:

1. Create a fresh directory under `tmpDir` with 40 files `f00.txt` …
   `f39.txt`, each containing `foo\n`.
2. Hold one `AbortController` and mock `AbortSignal.timeout` to return its
   signal (same `t.mock.method(AbortSignal, 'timeout', …)` pattern as the H1
   test).
3. Wrap the real write so the first completed write aborts the call:

   ```ts
   const realWrite = GuardedFileSystem.prototype.writeFile;
   t.mock.method(
     GuardedFileSystem.prototype,
     'writeFile',
     async function (this: GuardedFileSystem, ...a: Parameters<typeof realWrite>) {
       const out = await realWrite.apply(this, a);
       controller.abort(new DOMException('test timeout', 'TimeoutError'));
       return out;
     },
   );
   ```

   Import `GuardedFileSystem` from `'../src/core/fs.ts'`.

4. Call `replace_text` with
   `{ path: dir, searchPattern: 'foo', replacement: 'foobar' }`.
5. Assert:
   - `(result._meta as { stoppedReason?: string }).stoppedReason === 'timeout'`
   - the text matches `/file\(s\) were already rewritten and stay changed/u`
   - read every file; count those whose content is `foobar\n`. That count is
     at least 1 and less than 40.
   - the number in the line (`/(\d+) file\(s\) were already rewritten/u`)
     equals that on-disk count.

Add a second, short test: the same setup with `dryRun: true` must **not**
contain `already rewritten`, and every file must still read `foo\n`.

**Verify**: `node --test --test-timeout=60000 --test-name-pattern="replace_text timeout" __tests__/tools.test.ts`
→ all pass, including the 2 new tests and the existing H1 test.

### Step 3: Docs

1. `docs/configuration.md:203` — change the row's left cell to
   `` `list`, `stat`, `read`, search tools and `replace_text` `` and keep
   the right cell. Re-align the table with Prettier.
2. `docs/client-guide.md:362-366` — replace the bullet with:

   ```markdown
   - `list`, `stat` and `read` stop themselves after about 5 seconds with a
     `TIMEOUT` error. `find_files` and `search_text` stop at the same
     deadline but return what they found so far, with
     `_meta.stoppedReason: 'timeout'` (see
     [Pagination](#pagination-and-cached-results)). `replace_text` stops at
     the same deadline too: in a live run the files it already rewrote stay
     rewritten, and the text names them. Run a wide replacement with
     `dryRun: true` first. `maxResults` does not shorten a scan; a narrower
     `path`, `pattern`, or `maxDepth` does.
   ```

**STOP** before editing if `read.ts` no longer has
`timeoutMs: DEFAULT_SEARCH_TIMEOUT_MS` (`grep -n timeoutMs src/tools/read.ts`).

**Verify**: `npx prettier --check docs/` → exit 0 (run `--write` first).

### Step 4: CHANGELOG

Under `## [Unreleased]` at the top of `CHANGELOG.md` (create it above
`## [2.8.1]` if missing), add under `### Changed` (create if missing):

```markdown
- **A `replace_text` timeout says what it already wrote.** A live run that
  hits the 5-second deadline keeps the files it already rewrote. Its text now
  names them and warns that re-running the same replacement applies it to
  them again.
```

**Verify**: `npx prettier --check CHANGELOG.md` → exit 0.

### Step 5: Full check

**Verify**: `npm run check` → exit 0; `node --test __tests__/contract.test.ts`
→ pass with no snapshot change.

## Test plan

- New: timed-out live run names its rewritten files, count matches disk.
- New: timed-out dry run has no "already rewritten" line and writes nothing.
- Existing: H1 "never writes a partially spliced file" stays green.

## Done criteria

- [ ] `npm run check` exits 0
- [ ] `grep -n "already rewritten" src/tools/replace-text.ts` → 1 match
- [ ] `grep -n "replace_text" docs/configuration.md | grep -i "5 seconds"` → 1 match
- [ ] Contract snapshot unchanged
- [ ] Only in-scope files changed; `plans/README.md` row 066 updated

## STOP conditions

- The `run` excerpt in "Current state" does not match the live code.
- The on-disk count and the reported count differ in the new test on two
  consecutive runs. That would mean bookkeeping and disk disagree, which is
  a real bug to report, not a test to loosen.
- `contract.test.ts` fails.

## Maintenance notes

- If `replace_text` later becomes all-or-nothing (scan and plan within the
  deadline, then write without one), delete this line and its tests.
- The five-path cap matches the style of the three-failure cap below it;
  both keep the text short.
