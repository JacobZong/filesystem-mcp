# Plan 071: A read cancelled before its stream opens never crashes the server

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8deb0d50..HEAD -- src/core/read.ts __tests__/core-fs.test.ts CHANGELOG.md`
> If `src/core/read.ts` changed, compare the excerpts below against the live
> code; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — two one-line guards before a stream is created.
- **Depends on**: none. Plan 066 depends on this one: its test triggers the
  crash.
- **Category**: bug (process crash)
- **Planned at**: commit `8deb0d50`, 2026-10-13 (found while executing 066)

## Why this matters

When `FileHandle.createReadStream({ signal })` gets a signal that has
**already** aborted, Node emits the `AbortError` twice. One copy reaches the
`for await` loop and is caught. The other is an `'error'` event with no
listener, so it becomes an **uncaught exception**. Reproduced standalone on
Node 24:

```js
import { open } from 'node:fs/promises';

process.on('uncaughtException', (e) => console.log('UNCAUGHT', e.name));
const h = await open(process.argv[2]);
const c = new AbortController();
c.abort(new DOMException('t', 'TimeoutError'));
const s = h.createReadStream({ start: 0, autoClose: false, emitClose: false, signal: c.signal });
try {
  for await (const x of s) {
  }
} catch (e) {
  console.log('caught', e.name);
}
// prints: caught AbortError, then UNCAUGHT AbortError
```

`src/index.ts:121-124` handles `uncaughtException` by shutting the server
down with exit code 1. So any tool call whose read stream is created after
its signal aborted takes down the whole server, on every transport and for
every client. `replace_text` hits it: when the 5 s deadline or a client
cancel fires, other workers already dispatched open their next file and
create the stream with the aborted signal. Plan 066's test reproduced it on
4 of 4 runs (server log, then an uncaught `AbortError` from
`readFileBufferWithLimit` via `readReplacementPlan`).

After this plan, both stream sites throw the abort before creating the
stream, so the caller's normal abort handling runs and nothing is uncaught.

## Current state

- `src/core/read.ts:87-100` — `readFileBufferWithLimit`:

  ```ts
  export async function readFileBufferWithLimit(
    handle: FileHandle,
    maxSize: number,
    requestedPath: string,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const stream = handle.createReadStream({
      start: 0,
      highWaterMark: STREAM_CHUNK_SIZE,
      autoClose: false,
      emitClose: false,
      signal,
    });
  ```

  Callers: `src/core/read.ts:402` (`readFullContent`, the `read` tool's
  whole-file path) and `src/tools/replace-text.ts:333`
  (`readReplacementPlan`).

- `src/core/read.ts:161-173` — `readLinesBounded` (an async generator used
  by `readRangeContent` at `:259`):

  ```ts
  async function* readLinesBounded(
    handle: FileHandle,
    options: ReadOptions,
    filePath: string,
    startLine: number,
  ): AsyncGenerator<string, void, undefined> {
    const stream = handle.createReadStream({
      start: 0,
      highWaterMark: STREAM_CHUNK_SIZE,
      autoClose: false,
      emitClose: false,
      ...(options.signal ? { signal: options.signal } : {}),
    });
  ```

  `readRangeContent` calls `options.signal?.throwIfAborted()` (`:247`)
  before it builds the generator, but the generator body runs only at its
  first `next()`, so the guard belongs inside the generator.

- The repo already uses `signal?.throwIfAborted()` as its abort idiom
  (`src/core/read.ts:247`, `:517`, `:522`).
- `__tests__/core-fs.test.ts` — core filesystem tests. It imports
  `node:test` (`describe`, `it`, `mock`), `fsPromises` from
  `node:fs/promises`, and has a `tmpDir`-based setup. Put the new tests
  there.

## Commands you will need

| Purpose    | Command                                                      | Expected on success |
| ---------- | ------------------------------------------------------------ | ------------------- |
| Install    | `npm ci`                                                     | exit 0              |
| Core tests | `node --test --test-timeout=60000 __tests__/core-fs.test.ts` | all pass            |
| Full check | `npm run check`                                              | exit 0              |

## Scope

**In scope**: `src/core/read.ts` (the two functions above),
`__tests__/core-fs.test.ts`, `CHANGELOG.md`, `plans/README.md` (status row).

**Out of scope**: `src/index.ts` (the crash handler is correct: an uncaught
exception is a bug to fix, not to swallow), `src/core/search.ts` (it uses
`handle.readFile({ signal })`, not a stream), every tool file.

## Git workflow

- Branch: `advisor/071-aborted-read-stream`
- Message style, e.g. `fix(read): never open a read stream on an aborted signal`.
- Do NOT push or open a PR unless instructed.

## Steps

### Step 1: Failing test first

In `__tests__/core-fs.test.ts`, add a `describe('aborted read streams', …)`
with one test, `'a pre-aborted signal rejects without an uncaught exception'`:

```ts
const file = join(tmpDir, 'pre-aborted.txt'); // use the file's existing temp dir variable
await fsPromises.writeFile(file, 'line one\nline two\n');
const uncaught: unknown[] = [];
const onUncaught = (error: unknown): void => {
  uncaught.push(error);
};
process.on('uncaughtException', onUncaught);
try {
  const controller = new AbortController();
  controller.abort(new DOMException('test timeout', 'TimeoutError'));
  const handle = await fsPromises.open(file, 'r');
  try {
    await assert.rejects(
      readFileBufferWithLimit(handle, 1024, file, controller.signal),
      (err: unknown) =>
        (err as { name?: string }).name === 'TimeoutError' ||
        (err as { name?: string }).name === 'AbortError',
    );
  } finally {
    await handle.close();
  }
  // The stray 'error' event fires on a later tick.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepStrictEqual(uncaught, []);
} finally {
  process.off('uncaughtException', onUncaught);
}
```

Import `readFileBufferWithLimit` from `'../src/core/read.ts'`. Use whatever
temp-dir variable the surrounding tests use instead of `tmpDir` if it is
named differently.

Add a second test for the range path through the public entry
`readFileWithStats` (also exported from `src/core/read.ts`). Read its
signature at `src/core/read.ts:505-511` and its `ReadSpec` type; call it with
a spec that requests a line range (for example `startLine: 1, endLine: 1`)
and a pre-aborted `signal`, and the same uncaught-listener assertion. If
`readFileWithStats` already rejects before reaching the stream (its own
`spec.signal?.throwIfAborted()` at `:517`), the test still passes; keep it as
a guard.

**Verify**: `node --test --test-timeout=60000 __tests__/core-fs.test.ts` →
the first new test **fails** on `assert.deepStrictEqual(uncaught, [])` (or
the runner reports the uncaught `AbortError`). If it passes before step 2,
STOP: the premise is wrong on this Node version.

### Step 2: Guard both stream sites

1. In `readFileBufferWithLimit`, as its first statement:

   ```ts
   // Node emits an already-aborted signal's AbortError twice: once to the
   // iterator and once as an 'error' event no one listens to yet, which is
   // an uncaught exception and shuts the server down. Throw it here instead.
   signal?.throwIfAborted();
   ```

2. In `readLinesBounded`, as its first statement:
   `options.signal?.throwIfAborted(); // see readFileBufferWithLimit`

**Verify**: `node --test --test-timeout=60000 __tests__/core-fs.test.ts` →
all pass.

### Step 3: CHANGELOG and full check

Under `## [Unreleased]` (create above `## [2.8.1]` if missing), `### Fixed`
(create if missing):

```markdown
- **A cancelled or timed-out read no longer shuts the server down.** A file
  read that started after its call was cancelled, for example a
  `replace_text` worker opening its next file after the 5-second deadline,
  raised an uncaught `AbortError` and the server exited.
```

**Verify**: `npm run check` → exit 0.

## Test plan

- New: pre-aborted `readFileBufferWithLimit` rejects, nothing uncaught.
- New: pre-aborted range read rejects, nothing uncaught.
- Existing: H1 "a live replace_text timeout never writes a partially
  spliced file" (`__tests__/tools.test.ts`) stays green (`npm run check`).

## Done criteria

- [ ] `npm run check` exits 0
- [ ] `grep -c "throwIfAborted" src/core/read.ts` is 2 more than at `8deb0d50`
- [ ] The step-1 test failed before step 2 (say so in the commit body)
- [ ] Only in-scope files changed; `plans/README.md` row 071 updated

## STOP conditions

- The excerpts do not match the live code.
- The step-1 test passes before the fix.
- After step 2 an uncaught `AbortError` still appears in any test run.

## Maintenance notes

- Any new `createReadStream({ signal })` in `src/` needs the same guard.
  `grep -rn "createReadStream(" src` should list only these two sites.
- An abort that lands **after** the stream exists is handled by the stream
  (the H1 test covers it); only the pre-aborted case double-emits.
