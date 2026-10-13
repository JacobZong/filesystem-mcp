---
kind: frontier-ticket
id: T-13
title: Deliver the transport batch (findings 5, 10, 11)
map: M-01
status: in-progress
type: task
mode: afk
priority: 60
blocked_by: ["T-06", "T-07"]
claimed: 2026-10-13T22:00:00Z
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
