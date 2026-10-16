---
kind: frontier-ticket
id: T-12
title: Deliver batch E - shared ordered-collect driver for search scans (finding 5)
map: M-01
status: closed
type: task
mode: afk
priority: 100
blocked_by: [T-05]
claimed:
---

## Question

Deliver finding 5 per [the audit asset](../assets/audit-findings.md), only
after [its premise](T-05-batch-e-premise-scan-drivers.md) resolved live and
proposed the driver signature: extract the shared ordered-collect ladder into
`concurrency.ts`, shrink `searchContent` and `searchFiles` to their per-file
logic. No behavior change; existing search tests pin the ladder. Drift check
first (`git diff 35c0daa0..HEAD -- src/core/search.ts`); a premise mismatch is
a STOP — search.ts is a hot file. Own PR; contract completion check;
resolution links the PR and names the driver signature.

## Resolution

Out of scope. Finding 5 failed the audit's net-deletion gate at premise
check ([batch E premise](T-05-batch-e-premise-scan-drivers.md)): ~20 shared
orchestration lines, driver nets ~0 to +8. Nothing to deliver; the finding
moves to the asset's dropped list.
