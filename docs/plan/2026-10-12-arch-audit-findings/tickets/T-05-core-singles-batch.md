---
kind: frontier-ticket
id: T-05
title: Deliver the core singles batch (findings 1, 6, 9)
map: M-01
status: in-progress
type: task
mode: afk
priority: 40
blocked_by: ["T-02", "T-03", "T-04"]
claimed: 2026-10-13T18:00:00Z
---

## Question

Deliver the core singles batch from
[audit findings](../../assets/audit-findings.md): findings 1 (`store.ts`
imports `MAX_OUTBOUND_RESULT_BYTES`) and 6 (`search.ts` inlines
`guardedEntries`). `store.ts` and `search.ts` are disjoint files.

Finding 9 (`readLeadingSample` drops its `size` parameter) already
shipped in [PR #72](https://github.com/j0hanz/filesystem-mcp/pull/72),
folded into the 2026-10-13 map's security fix by that map's T-03. The
title still names it, because titles never change.

Finding 1 is one of the two visible behaviour changes T-03 accepts. The
delivery follows the process T-02 settles for this batch, and completion
follows the map's execution contract. In the cross-map chain the
2026-10-13 map's T-06 settled, this PR is merge slot 2 of 7, after that
map's singles batch (PR #73, merged).

Priority 40: second in the risk-ascending merge chain T-04 settled.
