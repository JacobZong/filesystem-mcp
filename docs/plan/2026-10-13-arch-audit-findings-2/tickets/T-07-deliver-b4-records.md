---
kind: frontier-ticket
id: T-07
title: Deliver batch B4: F8, F9, F10 remainder
map: M-01
status: open
type: task
mode: hitl
priority: 100
blocked_by: [T-03, T-06]
claimed:
---

## Question

Batch B4 (records): F8 false subscribe-gate sentence deleted in `resources.ts` plus dated ADR-003 amendment; F9 `readOnly` normalized once in `server.ts`, registrar field typed `boolean`, three `?? false` deleted; F10 remaining anchors (`http-policy.ts` `parseAllowedHostsEnv` doc, ADR-001/002/003) swapped to grep-able symbol names where a symbol exists (T-02). Anchors are read only after B2 and B3 land, since they cite `move.ts`, `http.ts`, `resources.ts`.

Deliver under the map's execution contract
([map](../arch-audit-findings-2.map.md)): the moves in
[audit findings](../assets/audit-findings.md) as refined by
[T-01](T-01-behaviour-acceptance.md) and
[T-02](T-02-batching-merge-order.md), following the chain
[T-03](T-03-delivery-process.md) settles for this batch. Re-grep every site
before editing; grep every caller of a touched function before dispatch.
Commit, push and merge only on the user's go-ahead. Resolution records
`npm run check` result (test counts), net line delta, PR link.
