# Diagnose: resources-subscribe round-trip timed out once on ubuntu CI

Status: not reproduced (no cause named)

## Symptom

PR #84, CI run `38392746886` attempt 1, job "Check (ubuntu-latest)", step
`npm run test:coverage`. One test failed:

- `__tests__/resources-subscribe.test.ts`, "subscribe -> file modification ->
  notification -> unsubscribe".
- Its error: `no notifications/resources/updated for filesystem-mcp://file//tmp/fsmcp-test-UDHhMI/watch.txt within 5000ms (waited 5014ms; other URIs notified: none)`.
- The same commit passed on windows-latest. The ubuntu job's re-run (attempt
  2) passed, and the test took 374ms there.
- Attempt 1 was not slow overall. Other tests ran at their normal durations;
  for example, `outbound result limits` took 8553ms. So the notification never
  arrived; it was not merely late.
- Attempt 1's log has no `Watcher error`, `Failed to create watcher`,
  `ENOSPC` or `EMFILE` line.

## Reproduction attempts

All attempts ran on WSL2 Ubuntu (kernel 6.6.87.2) with Node 24.21.0 at
`2ffa6348`, a clean clone with `npm ci`. Inotify limits were
`max_user_instances=128` and `max_user_watches=524288`.

| Attempt | Command | Runs | Target test failed |
| :-- | :-- | :-- | :-- |
| Test file alone | `node --test --test-timeout=60000 __tests__/resources-subscribe.test.ts` | 20 | 0 |
| CI command | `npm run test:coverage` | 20 | 0 |
| CI command under overload | 4 parallel loops of `taskset -c 0-3 npm run test:coverage` | 80 | 0 |

Total: 0 failures in 120 runs. Per the diagnose protocol, no cause is named
for a symptom that does not reproduce.

## Side observation (not this symptom)

Under the overload attempt (4 full suites at once on 4 CPUs), all 80 runs
failed in `__tests__/outbound-regressions.test.ts`, "outbound result limits".
Its stdio subtests hit their 5000ms client timeouts. These are the most
frequent:

| Count | Subtest |
| :-- | :-- |
| 80 | refuses duplicated search output |
| 75 | a refused first page takes back its page snapshot too |
| 72 | a refused first page takes back the cached result it stored |
| 47 | counts JSON escaping even for one match |

This is load the CI runner does not see. Every sequential run, and both CI
attempts, passed these tests. It shows only that those stdio tests carry fixed
5s timeouts that sustained 4x oversubscription exceeds. It is not evidence
about the subscribe failure.

## What reading suggests, unconfirmed

`resources/subscribe` arms its watcher before it answers.
`registry.acquire` awaits path validation, then `attach` calls `fs.watch` on
the file's parent directory synchronously (`src/core/watcher-registry.ts`,
`attach`). The test's write happens after `subscribeResource` resolves. On that
reading, the test has no race between arming and writing. A dropped or
coalesced inotify event on the runner, or a watcher `'error'` (which only logs
and drops the watcher), would match the symptom. None of these was observed.

## Handoff

- **No fix planned.** Nothing reproduces, so write-plan has no gate.
- **If it recurs:** capture attempt-1 stderr in full (look for `Watcher error
  for`) and the runner's inotify limits. Then route it to the testing audit's
  flake work (`docs/plan/2026-10-12-*`).
- **Regression case:** none. There is no repro to keep.
