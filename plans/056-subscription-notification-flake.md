# Plan 056: Find out why Linux CI sometimes misses a `resources/updated` notification, then fix the cause

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3da494ae..HEAD -- __tests__/helpers.ts __tests__/resources-subscribe.test.ts __tests__/stdio.test.ts src/core/watcher-registry.ts src/resources.ts src/transport/stdio.ts src/transport/shared.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED. The cause is unknown. It may be a slow test, or a real
  product race that drops a client's change notification.
- **Depends on**: none (plan 055's `--test-timeout` is helpful but not required)
- **Category**: tests (investigation first; may end in a product bug report)
- **Planned at**: commit `3da494ae`, 2026-10-12

## Why this matters

`main` CI went red twice in four days on the **Ubuntu** leg only. Both times
a subscription test waited 5 s for a `notifications/resources/updated` that
never came. Both runs were re-run green, and a release was cut from that
commit minutes later:

| Run (attempt 1)         | Commit     | Failing test                                                                                               | Release after re-run |
| ----------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- | -------------------- |
| 37921245384, 2026-10-09 | `bfec450a` | `__tests__/resources-subscribe.test.ts:36` `subscribe -> file modification -> notification -> unsubscribe` | v2.7.5               |
| 38236371485, 2026-10-12 | `b1d96f99` | `__tests__/stdio.test.ts:100` `STDIO-003: subscriptions/listen delivers resource updates over stdio`       | v2.7.6               |

The failure text both times:
`AssertionError [ERR_ASSERTION]: no notifications/resources/updated for filesystem-mcp://file//tmp/fsmcp-test-XXXX/<name>.txt within 5000ms`
`at waitForResourceUpdate (__tests__/helpers.ts:89:10)`.

The two tests use different paths. One is the 2025-era `resources/subscribe`
over an in-memory pair. The other is the 2026-era `subscriptions/listen` over
a real stdio subprocess. They share only the watcher registry and the test
helper, so the cause is in one of those two places or in `fs.watch` on Linux.
A later plan (064) makes CI a required merge check, and a flaky required
check teaches everyone to click "re-run". If the cause is a product race,
real clients miss file-change notifications. That is a correctness bug, not
only a test problem.

The aim of this plan is a **root cause backed by evidence**. A larger timeout
or a retry loop is not the aim.

## Current state

- `__tests__/helpers.ts:70-90`, the polling helpers:

```ts
/** Poll until `condition` holds or `timeoutMs` elapses; for debounced notifications. */
export async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) {
    await setTimeout(20);
  }
}

/** Resolve when `client` receives notifications/resources/updated for `uri`. Replaces any handler registered for the method. */
export async function waitForResourceUpdate(
  client: Client,
  uri: string,
  timeoutMs = 5000,
): Promise<void> {
  let arrived = false;
  client.setNotificationHandler('notifications/resources/updated', (n) => {
    if ((n.params as { uri: string }).uri === uri) arrived = true;
  });
  await waitFor(() => arrived, timeoutMs);
  assert.ok(arrived, `no notifications/resources/updated for ${uri} within ${timeoutMs}ms`);
}
```

The handler is registered **after** the test's `writeFile` resolves (see
below). That is safe only if the notification cannot arrive before the
helper runs. The registry debounces by 50 ms, so this is very likely but
not guaranteed.

- `__tests__/resources-subscribe.test.ts:36-44`:

```ts
it('subscribe -> file modification -> notification -> unsubscribe', async () => {
  const filePath = join(tmpDir, 'watch.txt');
  const uri = buildFileResourceUri(filePath);

  await pair.client.subscribeResource({ uri });

  // Trigger file modification
  await writeFile(filePath, 'changed');
  await waitForResourceUpdate(pair.client, uri);
```

`watch.txt` was written with `'initial'` in the suite's `before()` (line 28).

- `__tests__/stdio.test.ts:100-111`:

```ts
it('STDIO-003: subscriptions/listen delivers resource updates over stdio', async () => {
  // The SDK acknowledges the listen and routes outbound change notifications,
  // but attaches no watcher — the entry taps the wire for the inbound filter
  // so one gets attached. Without that tap this never fires.
  const filePath = await writeTestFile(tmpDir, 'listen.txt', 'initial');
  const uri = buildFileResourceUri(filePath);

  subscriptions.push(await harness.client.listen({ resourceSubscriptions: [uri] }));
  await writeFile(filePath, 'changed');

  await waitForResourceUpdate(harness.client, uri);
});
```

Note: `listen.txt` is created just before the listen, and the watcher is
attached after that write. inotify reports nothing from before
`inotify_add_watch`, so only the `changed` write can raise events.

- `src/core/watcher-registry.ts`:
  - `:106-130` `notifyAll` debounces per URI with a 50 ms `setTimeout`
    (`timer.unref()`), then calls every registered callback.
  - `:192-235` `attach`: for a **file**, it watches the **parent directory**
    and filters by name (plan 035, so atomic renames keep firing):

```ts
const isDirectory = statSync(resolvedPath).isDirectory();
const watcher = isDirectory
  ? watch(resolvedPath, { recursive: true }, () => {
      notifyAll(uri);
    })
  : watch(dirname(resolvedPath), (_event, filename) => {
      if (filename === null || filename === basename(resolvedPath)) notifyAll(uri);
    });
```

- `:268-332` `acquire` awaits `pathGuard.validateExistingPath`, then
  `addCallback` + `attach` + `retain`, and only then returns `{ ok: true }`.
- `src/resources.ts:251-294` `subscribe(uri, notify)` returns the `acquire`
  promise. The SDK awaits it before it answers `resources/subscribe`, so the
  watcher should exist before the client's `subscribeResource` resolves.
  **Confirm this in step 3. Do not assume it.**
- `src/transport/stdio.ts:295-333`, the stdio listen tap. It holds the listen
  message in a `gated` promise chain, runs `prepareListenWatchers` (which
  calls `registry.acquire`), and only then `deliver(message)` to the SDK, which
  sends the ack. So the watcher should also exist before `listen()` resolves.
- `plans/README.md` already records a **different** flake in
  `subscriptions-listen.test.ts`: the process dies at about 550 ms with no
  assertion. Do not mix the two up.

## Hypotheses (ranked; the investigation decides)

- **H1, late delivery under load.** The notification arrives, but after more
  than 5 s, because the runner was saturated: `node --test` runs files in
  parallel, and `stdio.test.ts` spawns many subprocesses. Evidence would be
  arrival at 5–15 s when the helper waits longer.
- **H2, event never raised.** inotify on the parent directory delivers no
  event for the write, or the `filename` does not equal
  `basename(resolvedPath)`, for example because `resolvedPath` is a realpath
  that differs from the directory spelling. Evidence would be no `fs.watch`
  callback for the file at all.
- **H3, event raised, callback missing.** `fs.watch` fires, but
  `activeCallbacks` has no entry for the URI (a lease released early, or a
  different URI spelling). Evidence would be the `fs.watch` callback logging
  without `notifyAll` finding callbacks.
- **H4, sent but dropped client-side.** The server sends it, but the client
  handler is not in place: it was registered after arrival, or another test's
  handler replaced it. Evidence would be the server-side send logged with no
  arrival in the helper.

## Commands you will need

| Purpose               | Command                                                                     | Expected on success |
| --------------------- | --------------------------------------------------------------------------- | ------------------- |
| The two tests (Linux) | `node --test __tests__/resources-subscribe.test.ts __tests__/stdio.test.ts` | `fail 0`            |
| Full suite            | `npm test`                                                                  | `fail 0`            |
| Full check            | `npm run check`                                                             | exit 0              |

Baseline at planning time: 586 tests, 582 pass, 4 skipped (Windows), 0 fail.
Both observed failures happened on **Linux** (GitHub `ubuntu-latest`, 4 vCPU).

## Suggested executor toolkit

- If available, use the `superpowers:systematic-debugging` or
  `workbench:diagnose` skill. This is a reproduce-first investigation.

## Scope

**In scope** (the only files you should modify and commit):

- `__tests__/helpers.ts`: `waitForResourceUpdate`, `waitFor`, and a new
  `expectResourceUpdate` export (step 5, H4 only)
- `__tests__/resources-subscribe.test.ts`, `__tests__/stdio.test.ts`: only
  the two tests named above
- `plans/README.md`: status row plus the findings note (step 6)

**Temporary only** (allowed while investigating, must be reverted before the
commit): `console.error` instrumentation in `src/core/watcher-registry.ts`,
`src/resources.ts` and `src/transport/stdio.ts`.

**Out of scope** (do NOT change in this plan):

- Any **committed** change under `src/`. If the evidence points to a product
  bug (H2/H3, or an ordering race), STOP and report it with the evidence. The
  fix needs its own reviewed plan, because this code is the subscription
  contract.
- The 50 ms debounce, `MAX_WATCHERS`, plan 035's parent-directory watching.
- Other subscription tests (`subscriptions-listen.test.ts`, the lease tests
  in `stdio.test.ts:250+`).
- Blanket retries, such as re-running a failed test automatically.

## Git workflow

- Branch: `advisor/056-subscription-notification-flake`
- Commits: one for the diagnostic helper (step 1), one for the fix (step 5)
  if any. Style: `test(subscriptions): …`.
- Do NOT push or open a PR unless the operator instructed it. Step 2 option C
  needs the operator's explicit approval to push a throwaway branch.

## Steps

Edit and commit in `C:\filesystem-mcp` (Windows). Run the Linux loops in the
environment from step 2, and pull the branch into it after each commit.

### Step 0: Branch

`git switch -c advisor/056-subscription-notification-flake`

### Step 1: Make the helper's failure message diagnostic (committed, every path)

Change `waitForResourceUpdate` in `__tests__/helpers.ts` so that a timeout
says what **did** arrive. This helps every future CI failure whatever the
root cause, and it makes step 2's logs classifiable. Keep the signature, the
5000 ms default and the first sentence of the doc comment:

```ts
export async function waitForResourceUpdate(
  client: Client,
  uri: string,
  timeoutMs = 5000,
): Promise<void> {
  const started = Date.now();
  let arrived = false;
  const others: string[] = [];
  client.setNotificationHandler('notifications/resources/updated', (n) => {
    const got = (n.params as { uri: string }).uri;
    if (got === uri) arrived = true;
    else others.push(got);
  });
  await waitFor(() => arrived, timeoutMs);
  assert.ok(
    arrived,
    `no notifications/resources/updated for ${uri} within ${timeoutMs}ms ` +
      `(waited ${String(Date.now() - started)}ms; other URIs notified: ${others.length ? others.join(', ') : 'none'})`,
  );
}
```

Run `npx prettier --write __tests__/helpers.ts`, then commit:
`test(subscriptions): say what arrived when a resource update times out`.

**Verify**: `npm run type-check:test && npm run lint` → exit 0, and
`npm test -- --test-name-pattern="subscribe|STDIO-003"` → `fail 0`.

### Step 2: Get a Linux environment and count reproductions

`fs.watch` on Linux uses inotify. **inotify does not work on Windows-mounted
paths in WSL (`/mnt/c/...`)**, so a WSL run must use a clone on the Linux
filesystem. Run as a **non-root** user: root fails `TC-FUNC-009l` on every
run (see plan 061). Use the first option that is available:

- **A.** A native Linux machine or container with Node 24 (`node --version` → `v24.*`).
- **B.** WSL Ubuntu. Node is **not** installed there on the planning machine.
  Ask the operator before installing Node 24 inside WSL. Then:
  `git clone /mnt/c/filesystem-mcp ~/fsmcp && cd ~/fsmcp && git checkout advisor/056-subscription-notification-flake && npm ci`.
  After each later commit on Windows:
  `cd ~/fsmcp && git pull /mnt/c/filesystem-mcp advisor/056-subscription-notification-flake`.
- **C.** With the operator's explicit approval only: push a throwaway branch
  `tmp/056-repro` that adds `.github/workflows/tmp-056-repro.yml` with
  `on: push: branches: [tmp/056-repro]` and one `ubuntu-latest` job:
  `actions/checkout@v6`, `actions/setup-node@v6` with `node-version: 24`,
  `npm ci`, then the loops below, then
  `for f in /tmp/*.failed; do [ -e "$f" ] && tail -n 200 "${f%.failed}.log"; done`.
  Delete it afterwards: `git push origin --delete tmp/056-repro`.

If none of A–C is available, commit step 1 only, take the no-repro path in
step 6 with the reason "no Linux environment", and report.

Reproduction loops (bash, repo root, Linux). Failures are counted by exit
code and by the assertion text, so they do not depend on the timeout value:

```bash
rm -f /tmp/sub-* /tmp/full-*
# Targeted: the two tests, 4 copies at a time to add load, 50 rounds = 200 runs.
for i in $(seq 1 50); do
  for j in 1 2 3 4; do
    ( node --test __tests__/resources-subscribe.test.ts __tests__/stdio.test.ts \
        > "/tmp/sub-$i-$j.log" 2>&1 || touch "/tmp/sub-$i-$j.failed" ) &
  done
  wait
done
echo "targeted failed runs: $(ls /tmp/sub-*.failed 2>/dev/null | wc -l)/200"
echo "targeted notify misses: $(grep -l 'no notifications/resources/updated' /tmp/sub-*.log | wc -l)"

# Realistic: the whole suite, 30 times.
for i in $(seq 1 30); do npm test > "/tmp/full-$i.log" 2>&1 || touch "/tmp/full-$i.failed"; done
echo "full notify misses: $(grep -l 'no notifications/resources/updated' /tmp/full-*.log | wc -l)/30"
```

**Verify**: record the three counts. If **both "notify misses" counts are 0**,
go to step 6 (no-repro path). Otherwise continue. Any failed run without a
notify miss is unrelated. Note its test name and ignore it here.

### Step 3: Instrument and classify (temporary, NOT committed)

In the Linux clone only, add temporary `console.error` lines with
`Date.now()` at these points:

1. `src/core/watcher-registry.ts` `attach`, just after the `watch(...)` call: `attach <uri> dir=<dirname> base=<basename(resolvedPath)> t=<now>`.
2. The `fs.watch` callback for files, before the filter: `fswatch <uri> event=<_event> filename=<filename> t=<now>`.
3. `notifyAll` entry: `notifyAll <uri> callbacks=<count> t=<now>`.
4. The debounce timer body, before the callback loop: `fire <uri> callbacks=<count> t=<now>`.
5. `src/resources.ts` `subscribe`, when `acquire` resolves: `subscribe-acquired <uri> t=<now>`.
6. `src/transport/stdio.ts`, just before `deliver(message)` in the listen gate: `listen-delivered <id> t=<now>`.

In the two tests, temporarily:

- log `WROTE <uri> t=<now>` right after `await writeFile(...)` resolves;
- pass `30000` as `waitForResourceUpdate`'s `timeoutMs`;
- inside the helper's handler, on the matching URI, log
  `ARRIVAL <uri> elapsedMs=<now - started>`.

`StdioClientTransport` defaults `stderr` to `inherit`, so the child server's
`console.error` reaches the test's output. The default (spec) reporter
prints it. Do **not** use `--test-reporter=dot`, which drops test output.

Re-run step 2's loops. A **reproduction** is either an `ARRIVAL` line with
`elapsedMs` > 5000, or a run whose log contains
`no notifications/resources/updated`:

```bash
grep -h "ARRIVAL" /tmp/sub-*.log /tmp/full-*.log | awk -F'elapsedMs=' '$2>5000'
grep -l "no notifications/resources/updated" /tmp/sub-*.log /tmp/full-*.log
```

Classify each reproduction by the URI's log lines:

| Evidence                                                      | Label                   |
| ------------------------------------------------------------- | ----------------------- |
| no `fswatch` line for the file after `WROTE`                  | H2                      |
| `fswatch` present, but `notifyAll … callbacks=0` or no `fire` | H3                      |
| `fire` timestamp earlier than `WROTE`'s                       | H4 (late handler)       |
| `fire` after `WROTE`, no `ARRIVAL`                            | H4 (other)              |
| `ARRIVAL` with `elapsedMs` > 5000                             | H1                      |
| `subscribe-acquired`/`listen-delivered` later than `WROTE`    | ordering race (product) |

**Verify**: a table of reproductions, each with its timestamps and label. If
two passes of both loops give **fewer than 3** reproductions, record every
one you got, then take the no-repro path in step 6 with the status
`DONE (diagnostics only; N/M reproduced, root cause open)`.

### Step 4: Decide

- **H1 only:** this is test-side load, so go to step 5.
- **H2, H3, or the ordering race:** this is a product bug. STOP. Revert all
  instrumentation and report the evidence table, the step 1 commit, and a
  one-paragraph root-cause statement.
- **H4 (late handler):** go to step 5. **H4 (other):** STOP and report.
- **Mixed labels:** report all of them and STOP.

### Step 5: Test-side fix (H1 or H4-late-handler only)

Revert every temporary change first (`git checkout -- src/ __tests__/` in the
Linux clone, then pull again).

- **H4 (late handler):** add to `__tests__/helpers.ts`:

```ts
/** Arm the handler before the trigger; `wait()` resolves on arrival or fails like waitForResourceUpdate. */
export function expectResourceUpdate(
  client: Client,
  uri: string,
  timeoutMs = 5000,
): { wait(): Promise<void> } {
  /* register the handler now; wait() polls with waitFor and asserts */
}
```

Re-implement `waitForResourceUpdate` as
`expectResourceUpdate(client, uri, timeoutMs).wait()` (same message). In
both tests, arm the handler before the write:

```ts
const update = expectResourceUpdate(pair.client, uri); // harness.client in STDIO-003
await writeFile(filePath, 'changed');
await update.wait();
```

- **H1 (load):** let W be the largest `elapsedMs` measured in step 3. If
  2×W > 20000, STOP: that is starvation, not a timeout to tune. Otherwise
  set the default `timeoutMs` of `waitForResourceUpdate` to
  `ceil(2×W / 1000) × 1000`, with a one-line comment such as
  `// worst arrival 7.3s under 4x load on Linux (plan 056)`.

Run `npx prettier --write __tests__/`, then commit
`test(subscriptions): <what changed>`.

**Verify**: re-run step 2's loops after pulling. Both "notify misses" counts
are 0 (out of 200 and 30). Then on Windows: `npm run check` → exit 0.

### Step 6: Record the result

- Set the `| 056 |` row's Status cell in `plans/README.md`
  (`## Execution order & status`).
- Append one bullet to the end of the `### Batch 055–064` section under
  `## Dependency notes`:
  `- 056: <label(s)>, notify misses before <a/200, b/30> → after <c/200, d/30>, env <A/B/C>.`
- **No-repro path:** the bullet reads
  `- 056: not reproduced in 200 targeted + 30 full runs on <env>; diagnostic message added so the next CI failure is classifiable.`
  and the status is `DONE (diagnostics only; root cause open)`.

Run `npx prettier --write plans/README.md`.

## Test plan

- No new test cases. The two existing tests are the subject.
- Step 1's message is exercised by any future timeout. To see it once, make
  `writeFile` in `resources-subscribe.test.ts` write to a different file
  locally (not committed), confirm the message includes `waited` and
  `other URIs notified`, then revert.

## Done criteria

- [ ] `grep -n "other URIs notified" __tests__/helpers.ts` → 1 match
- [ ] `git diff main...HEAD -- src/` → empty (no committed product change)
- [ ] `grep -c console.error src/core/watcher-registry.ts src/resources.ts src/transport/stdio.ts` → `0` for each file (all three had 0 at `3da494ae`)
- [ ] Either: step 5's loops show 0/200 and 0/30 notify misses, or the plan STOPPED with an evidence table, or the no-repro path was recorded
- [ ] `npm run check` exits 0
- [ ] `plans/README.md` row and note updated

## STOP conditions

Stop and report back (do not improvise) if:

- The evidence shows a product-side cause (H2/H3, or a watcher attached
  after the subscribe/listen response). Report the table. Do not patch `src/`.
- 2×W exceeds 20 s (step 5). That is starvation, not a timeout to tune.
- Fixing one test makes the other, or any other subscription test, fail more
  often in the loops.

## Maintenance notes

- Any future test that waits for a change notification should arm its
  handler before the trigger, using the step 5 helper if it lands.
- Plan 061 adds `{ concurrency: true }` to stdio lease tests and so adds
  load. Re-run step 2's loops after 061 lands if this plan ended on H1.
- If this plan ended in a product bug report, the follow-up fix belongs in
  `watcher-registry.ts`. Its review should focus on the plan 035
  parent-directory filter (`filename === basename(resolvedPath)`) and the
  ordering between `acquire` and the response.
