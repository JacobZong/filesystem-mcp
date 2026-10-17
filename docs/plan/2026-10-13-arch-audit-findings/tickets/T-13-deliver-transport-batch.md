---
kind: frontier-ticket
id: T-13
title: Deliver the transport batch (findings 5, 10, 11)
map: M-01
status: closed
type: task
mode: afk
priority: 60
blocked_by: ["T-06", "T-07"]
claimed:
---

## Question

Deliver findings 5, 10 and 11 from
[audit findings](../assets/audit-findings.md) in one PR touching
`src/index.ts`, `src/cli.ts`, `src/server.ts` and
`src/transport/{shared,stdio,http}.ts`.

10: stdio always passes `cacheScope: 'public'`, and HTTP derives it from
its key ([Are the visible behavior changes acceptable?](T-04-behaviour-acceptance.md)).
It shares `server.ts` and `stdio.ts` with the 2026-10-12 map's
resources.ts batch (its finding 5), so the merge order T-06 settles
sequences the rebase.

Follow the process T-07 settles. Completion follows the map's execution
contract.

Priority 60: merge slot 6 of 7 (T-06). It merges only after the 2026-10-12 map's resources.ts batch (slot 5) is on `main`, and it rebases onto that batch's `voidSend`.

## Resolution

Delivered, 2026-10-13, via
[PR #78](https://github.com/j0hanz/filesystem-mcp/pull/78), merged to
`main` as `9d1e30e0` with the user's go-ahead (merge slot 6 of 7).

- Completion check (the execution contract):
  - Findings 5, 10 and 11 are in the diff. stdio always reports
    `public`, as T-04 settled.
  - `startServer` and `startHttpServer` keep their exported
    signatures.
  - `npm run check` exits 0: 677 tests, 672 pass, 5 skipped.
  - CI is green on all 6 checks.
- `src/` net line delta: +39 / -49 (-10).
- Process (T-07, planned):
  [plan](../transport-batch.plan.md), then
  [plan-hunt](../transport-batch.plan-hunt.md) (clean), then
  [run](../transport-batch.run.md), then one combined bug-hunt and qc
  review (approved; took the `_config?` nit).
- Run deviation: the `jsonRpcError` return type needed
  `id: Id | undefined` with a generic free of `undefined`. The plan's
  fallback dropped `null` under `exactOptionalPropertyTypes`.
