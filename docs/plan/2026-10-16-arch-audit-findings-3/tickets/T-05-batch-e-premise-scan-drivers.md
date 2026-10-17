---
kind: frontier-ticket
id: T-05
title: Batch E premise - how much do the two search scan drivers duplicate, and where does the shared driver live?
map: M-01
status: closed
type: research
mode: afk
priority: 100
blocked_by: []
claimed:
---

## Question

Does finding 5 of [the audit asset](../assets/audit-findings.md) hold live:
how many orchestration lines do `searchContent` and `searchFiles` actually
share, and what is the minimal driver signature that removes them?
Unblocks [batch E delivery](T-12-deliver-batch-e-collect-driver.md).

## Research context

- Unblocks: batch E delivery (T-12) — an ordered-collect driver in
  `concurrency.ts` parameterized by runEntry.
- Starting sources: `src/core/search.ts` `searchContent` (`:518-570` audit
  cite) and `searchFiles` (`:640-695`); `src/core/concurrency.ts`
  (`processEntriesConcurrently`, `resolveStopReason`).
- Scope and evidence: line-by-line diff of the two orchestration ladders
  (perFile map keyed by `dispatched - 1`, ordered replay, counters,
  `resolveStopReason` shape); name exactly what differs (per-file
  classification); propose the minimal driver signature in `concurrency.ts`
  and count the net deletion. Confirm no refuted-list collision (the 2026-10-02
  refuted `RE2 adapter pool` and `queryKey per tool` are different symbols).
  Cite `file:line` for every claim. A divergence that breaks the shared-driver
  shape is a failed return.

## Resolution

SHIFTED. The duplication is real but the finding's magnitude fails: shared
orchestration is ~20 verbatim lines, not ~50; a `runEntry`-parameterized
driver nets ~0 to +8, not -35 — the audit's count included the divergent
per-file logic that must stay in callers. Proposed signature
(`collectEntriesInOrder` in `concurrency.ts` beside `:123`) recorded, but
the move fails the audit's own net-deletion gate. No refuted-list collision.
Recommendation: drop finding 5; the 13-line dispatch-boilerplate re-scope
nets ~-5 at best — not worth a new abstraction. Batch E closed out of scope
at redraw.

Material uncertainty: ±4 lines on the driver estimate; immaterial to the
verdict.
