---
kind: frontier-ticket
id: T-06
title: Deliver batch B3: F6 and the sensitive.ts anchor
map: M-01
status: in-progress
type: task
mode: hitl
priority: 100
blocked_by: [T-03, T-05]
claimed: 2026-10-13T11:32:00Z
---

## Question

Batch B3 (primitives): F6 homes (`CHAR_COLON` + trim exported from `path-utils.ts`, `toPosixRelative` to `path-utils.ts`, `parseTrueEnvFlag` to `util.ts`, `splitDirList` decided or recorded, both headers fixed) plus F10's `sensitive.ts` stale `getReservedDeviceName (path.ts)` anchor, swapped to a symbol name. Branches after B2 merges; import lines in list/find-files/search-text/`path.ts` were touched by B2.

Deliver under the map's execution contract
([map](../arch-audit-findings-2.map.md)): the moves in
[audit findings](../assets/audit-findings.md) as refined by
[T-01](T-01-behaviour-acceptance.md) and
[T-02](T-02-batching-merge-order.md), following the chain
[T-03](T-03-delivery-process.md) settles for this batch. Re-grep every site
before editing; grep every caller of a touched function before dispatch.
Commit, push and merge only on the user's go-ahead. Resolution records
`npm run check` result (test counts), net line delta, PR link.
