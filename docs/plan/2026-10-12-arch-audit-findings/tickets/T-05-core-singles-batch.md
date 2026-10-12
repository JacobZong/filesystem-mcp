---
kind: frontier-ticket
id: T-05
title: Deliver the core singles batch (findings 1, 6, 9)
map: M-01
status: open
type: task
mode: afk
priority: 40
blocked_by: ["T-02", "T-03", "T-04"]
claimed:
---

## Question

Deliver the core singles batch from
[audit findings](../../assets/audit-findings.md): findings 1 (`store.ts`
imports `MAX_OUTBOUND_RESULT_BYTES`), 6 (`search.ts` inlines
`guardedEntries`), and 9 (`readLeadingSample` drops its `size` parameter).
`store.ts`, `search.ts`, `fs.ts` and `create.ts` are disjoint files, so
the three moves land in one PR. Finding 1 is one of the two visible
behaviour changes T-03 accepts. The delivery follows the process T-02
settles for this batch, the PR merges in the order T-04 settles, and
completion follows the map's execution contract.

Priority 40: second in the risk-ascending merge chain T-04 settled.