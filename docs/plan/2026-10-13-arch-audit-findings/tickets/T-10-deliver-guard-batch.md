---
kind: frontier-ticket
id: T-10
title: Deliver the guard batch (findings 4, 12, 15)
map: M-01
status: in-progress
type: task
mode: afk
priority: 40
blocked_by: ["T-06", "T-07"]
claimed: 2026-10-13T20:00:00Z
---

## Question

Deliver findings 4, 12 and 15 from [audit findings](../assets/audit-findings.md)
in one PR touching `src/core/path.ts` and `src/core/path-completer.ts`.

Constraints from
[What exactly changes in behavior for findings 3, 10, 12 and 15?](T-02-behaviour-deltas.md)
and [Are the visible behavior changes acceptable?](T-04-behaviour-acceptance.md):

- 12: wrap the guard call so a refusal returns false.
- 15: keep the empty-boundary early return, and land a pin test first.

Follow the process T-07 settles and the merge slot T-06 settles.
Completion follows the map's execution contract.

Priority 40: merge slot 4 of 7 (T-06), after the tool-code batch.
