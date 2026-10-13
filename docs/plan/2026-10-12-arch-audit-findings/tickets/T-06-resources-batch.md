---
kind: frontier-ticket
id: T-06
title: Deliver the resources.ts batch (findings 4 and 5)
map: M-01
status: open
type: task
mode: afk
priority: 50
blocked_by: ["T-02", "T-04"]
claimed:
---

## Question

Deliver the resources.ts batch from
[audit findings](../../assets/audit-findings.md): findings 4
(`registerResources` delegates to `getResourceContracts`) and 5 (the
`voidSend` notify helper in `core/observability.ts`, shrinking the three
call sites in `stdio.ts`, `resources.ts` and `server.ts`). Both touch
`resources.ts`, so they land in one PR; no visible behaviour changes. The
delivery follows the process T-02 settles for this batch, the PR merges in
the order T-04 settles, and completion follows the map's execution
contract.

Priority 50: third in the risk-ascending merge chain T-04 settled.