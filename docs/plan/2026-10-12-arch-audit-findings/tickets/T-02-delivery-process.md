---
kind: frontier-ticket
id: T-02
title: Which delivery process does each batch follow?
map: M-01
status: closed
type: grilling
mode: hitl
priority: 20
blocked_by: ["T-01"]
claimed: 2026-10-12T00:00:00Z
---

## Question

Once the batches exist (T-01, settled: four PRs), which delivery process
does each follow? The four batches are the resources.ts batch (findings 4
and 5), the test-cluster batch (findings 2 and 3), the core singles batch
(findings 1, 6 and 9), and the tool singles batch (findings 7 and 8). The
2026-10-02 precedent split by size: single-file or mechanical batches were
edited directly through `tdd` or `refactor`, then `bug-hunt` and `qc`; the
rest got one `write-plan` plan per batch, through `plan-hunt` and
`run-plan`.

## Resolution

Confirmed with the user: **all four batches deliver directly** — no
`write-plan` anywhere; the moves in
[audit findings](../../assets/audit-findings.md) are the plan. Per batch:

- Pin the visible behaviour with a test first where one changes — finding 1
  in the core singles batch (near-cap cache refusal), finding 7 in the tool
  singles batch (the TOO_LARGE message).
- Refactor otherwise: the resources.ts and test-cluster batches are pure
  behaviour-preserving moves.
- Then `bug-hunt` and `qc` on the batch before its PR merges.

Material uncertainty: none.

Priority 20: the process choice gates every per-batch delivery ticket.