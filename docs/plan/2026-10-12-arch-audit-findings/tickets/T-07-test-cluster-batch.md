---
kind: frontier-ticket
id: T-07
title: Deliver the test-cluster batch (findings 2 and 3)
map: M-01
status: in-progress
type: task
mode: afk
priority: 60
blocked_by: ["T-02", "T-04"]
claimed: 2026-10-13T23:00:00Z
---

## Question

Deliver the test-cluster batch from
[audit findings](../../assets/audit-findings.md): findings 2 (dissolve
`high-severity-fixes.test.ts` into `tools.test.ts`, `core-fs.test.ts` and
`stdio.test.ts`) and 3 (`modernClientMeta` in `helpers.ts`, applied at the
five stamp sites: `stdio.test.ts` twice, `input-required.test.ts`,
`cli.test.ts`, `http-server.test.ts`). Both touch `stdio.test.ts`, so they
land in one PR; no production files change. The delivery follows the
process T-02 settles for this batch, the PR merges in the order T-04
settles, and completion follows the map's execution contract.

Priority 60: last in the risk-ascending merge chain T-04 settled — the
most rebase-sensitive batch merges on the final base.