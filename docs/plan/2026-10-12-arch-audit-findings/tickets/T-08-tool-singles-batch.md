---
kind: frontier-ticket
id: T-08
title: Deliver the tool singles batch (findings 7 and 8)
map: M-01
status: in-progress
type: task
mode: afk
priority: 30
blocked_by: ["T-02", "T-03", "T-04"]
claimed: 2026-10-12T00:00:00Z
---

## Question

Deliver the tool singles batch from
[audit findings](../../assets/audit-findings.md): findings 7
(`replace-text.ts` calls `createTooLargeError(stats.size, maxFileSize,
validPath)` instead of the hand-rolled message) and 8 (`list.ts` passes
`signal: ctx.signal` instead of the shadowed second deadline timer).
`replace-text.ts` and `list.ts` are disjoint files, so both moves land in
one PR. Finding 7 is one of the two visible behaviour changes T-03
accepts. The delivery follows the process T-02 settles for this batch, the
PR merges in the order T-04 settles, and completion follows the map's
execution contract.

Priority 30: first in the risk-ascending merge chain T-04 settled.