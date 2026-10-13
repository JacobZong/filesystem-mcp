---
kind: frontier-ticket
id: T-01
title: Are the two behavior deltas acceptable as stated?
map: M-01
status: closed
type: grilling
mode: hitl
priority: 10
blocked_by: []
claimed:
---

## Question

Two findings change client-visible behavior (details in
[audit findings](../assets/audit-findings.md), findings 2 and 5):

- Finding 5 (oversize refusal): routing the three `read.ts` throws through
  `createTooLargeError` drops each site's in-message remedy tail ("Use a
  narrower range or head." and siblings) from the message text. The
  `suggestion` field keeps the remedy — clients reading only `message`
  text see less.
- Finding 2 (page-cache key): `paginate` building the key from args flips a
  forgotten or misclassified result-defining field from silent stale
  snapshot replay to loud `INVALID_CURSOR`. No change for valid queries.

Accept both as stated, narrow either, or reject one? If a delta is rejected,
that finding shrinks to its behavior-preserving core and the affected part
moves to the below-bar list.

Priority 10: the answers set the scope every later ticket plans against.

## Resolution

Decided 2026-10-13 (user, live):

- **Finding 5 — narrowed: forward each tail as `suggestion`.**
  `createTooLargeError` gains an optional label (interpolated into its
  parenthetical) and an optional `suggestion`, passed through to the
  `FsError` constructor's existing override (`src/core/errors.ts`, the
  `suggestion` parameter). Each of the three `read.ts` sites passes its own
  remedy as the suggestion: "Use a narrower range or head." (single-line),
  "Use a narrower tail or head." (readTailContent), "Use head to preview."
  (assertSizeWithinLimit, which still inlines away). Message text loses the
  tail; the `suggestion` field keeps the site-specific remedy instead of
  falling back to the generic TOO_LARGE default ("Use head/tail or line
  ranges to read partially."). Still 1 file.
  Evidence: the tails differ per site (`read.ts:179,374,440` at
  `4153e7e0`), so "double-states the auto-attached suggestion" held only
  loosely; the asset's refuted record "per-site remedies deliberate" points
  the same way.
- **Finding 2 — accepted as stated.** Valid queries unchanged; a forgotten
  or misclassified result-defining field flips from silent stale replay to
  loud `INVALID_CURSOR`.

Material uncertainty: none.

Redraw: T-02 unaffected (F5 stays `read.ts`-only; F2 file set unchanged).
T-03 unaffected. No fog graduates.
