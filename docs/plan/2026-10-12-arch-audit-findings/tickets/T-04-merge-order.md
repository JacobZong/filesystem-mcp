---
kind: frontier-ticket
id: T-04
title: In what order do the batch PRs merge?
map: M-01
status: closed
type: grilling
mode: hitl
priority: 100
blocked_by: ["T-01"]
claimed: 2026-10-12T00:00:00Z
---

## Question

Once the batches exist (T-01, settled: four PRs), in what order do the
batch PRs merge? The four batches are the resources.ts batch (findings 4
and 5), the test-cluster batch (findings 2 and 3), the core singles batch
(findings 1, 6 and 9), and the tool singles batch (findings 7 and 8). The
test cluster is self-contained on shared files (`stdio.test.ts` and
`helpers.ts` are internal to it), so no cross-batch test overlap remains;
the 2026-10-02 precedent was a fixed chain decided up-front, with the batch
most sensitive to its base merged last.

## Resolution

Confirmed with the user: **a fixed risk-ascending chain**, decided up-front:

1. tool singles (findings 7, 8) — two files, trivial moves
2. core singles (findings 1, 6, 9) — four files, the finding 1 test pin
3. resources.ts (findings 4, 5) — four files, the `voidSend` helper
4. test cluster (findings 2, 3) — seven files, biggest churn, most
   rebase-sensitive, last per the 2026-10-02 precedent

The batches are file-disjoint; the only cross-batch overlap is
CHANGELOG.md's Unreleased section, so each merge needs only a trivial text
rebase of the rest.

Material uncertainty: none.