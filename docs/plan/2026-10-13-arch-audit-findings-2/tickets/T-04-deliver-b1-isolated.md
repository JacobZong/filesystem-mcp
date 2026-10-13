---
kind: frontier-ticket
id: T-04
title: Deliver batch B1: F5, F7, F11
map: M-01
status: in-progress
type: task
mode: hitl
priority: 100
blocked_by: [T-03]
claimed: 2026-10-13T10:57:16Z
---

## Question

Batch B1 (isolated, no shared-file conflicts): F5 oversize refusal through `createTooLargeError` with per-site remedies forwarded as `suggestion` (T-01); F7 out-of-root fixture sites onto `createTestRoot`/`cleanupTestRoot`; F11 `MODERN_PROTOCOL_REVISION` re-exported from `__tests__/helpers.ts` at the three literal sites.

Deliver under the map's execution contract
([map](../arch-audit-findings-2.map.md)): the moves in
[audit findings](../assets/audit-findings.md) as refined by
[T-01](T-01-behaviour-acceptance.md) and
[T-02](T-02-batching-merge-order.md), following the chain
[T-03](T-03-delivery-process.md) settles for this batch. Re-grep every site
before editing; grep every caller of a touched function before dispatch.
Commit, push and merge only on the user's go-ahead. Resolution records
`npm run check` result (test counts), net line delta, PR link.
