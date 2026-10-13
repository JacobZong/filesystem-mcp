---
kind: frontier-ticket
id: T-05
title: Deliver batch B2: F1, F2, F3, F4
map: M-01
status: in-progress
type: task
mode: hitl
priority: 100
blocked_by: [T-03, T-04]
claimed: 2026-10-13T11:12:00Z
---

## Question

Batch B2 (tools): F1 both raw stats onto `ctx.fs.stat`; F2 page-cache key built from args minus per-tool paging fields (loud `INVALID_CURSOR` accepted, T-01); F3 one verdict helper in `input-required.ts`; F4 inline `isEntryAccessible` into `list.ts`. Internal overlaps: `move.ts` (F1/F3), `list.ts` (F2/F4), `search-text.ts` (F1/F2).

Deliver under the map's execution contract
([map](../arch-audit-findings-2.map.md)): the moves in
[audit findings](../assets/audit-findings.md) as refined by
[T-01](T-01-behaviour-acceptance.md) and
[T-02](T-02-batching-merge-order.md), following the chain
[T-03](T-03-delivery-process.md) settles for this batch. Re-grep every site
before editing; grep every caller of a touched function before dispatch.
Commit, push and merge only on the user's go-ahead. Resolution records
`npm run check` result (test counts), net line delta, PR link.
