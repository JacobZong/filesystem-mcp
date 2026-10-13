---
kind: frontier-ticket
id: T-10
title: Deliver the guard batch (findings 4, 12, 15)
map: M-01
status: closed
type: task
mode: afk
priority: 40
blocked_by: ["T-06", "T-07"]
claimed:
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

## Resolution

Delivered, 2026-10-13, via
[PR #76](https://github.com/j0hanz/filesystem-mcp/pull/76), merged to
`main` as `4df47601` with the user's go-ahead (merge slot 4 of 7).

- Completion check (the execution contract):
  - Findings 4, 12 and 15 are in the diff.
  - Both T-02 constraints hold: the guard refusal is wrapped (a
    root-suggestion test pins it), and the empty-boundary early return is
    kept.
  - `npm run check` exits 0: 676 tests, 671 pass, 5 skipped.
  - CI is green on all 6 checks.
- `src/` net line delta: +26 / -77 (-51).
- Process (T-07, planned):
  [plan](../guard-batch.plan.md), then
  [plan-hunt](../guard-batch.plan-hunt.md) (clean), then
  [run](../guard-batch.run.md) (both premises reproduced red first), then
  one combined bug-hunt and qc review (approved, nothing blocking).
- The review found a stricter outcome beyond T-04's acceptance: grants
  under an in-boundary symlink that points outside, or with an
  unresolvable parent, are now refused. The CHANGELOG records it.
