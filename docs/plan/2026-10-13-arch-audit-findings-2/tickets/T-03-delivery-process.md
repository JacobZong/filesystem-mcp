---
kind: frontier-ticket
id: T-03
title: Which delivery chain does each batch follow?
map: M-01
status: closed
type: grilling
mode: hitl
priority: 30
blocked_by: [T-02]
claimed:
---

## Question

[T-02](T-02-batching-merge-order.md) fixed four batches: B1 (F5, F7, F11),
B2 (F1-F4), B3 (F6 + F10's `sensitive.ts` anchor), B4 (F8, F9, F10
remainder). Which delivery chain does each batch follow — direct (pin test,
refactor, `bug-hunt`, `qc`), or planned (`write-plan`, `plan-hunt`,
`run-plan`, then `bug-hunt` and `qc`)? Precedent from the fifth audit: small
behavior-preserving batches went direct; guard/transport batches went
planned. B1 and B2 each carry one T-01 behavior delta (F5, F2).

Text-only findings (F8 subscribe-gate drift, F10 anchor sweep) change no
code behavior — what is their minimal chain? And do the test-only findings
(F7, F11) need `bug-hunt`/`qc` at all?

Priority 30: the choice rides on batch composition, so blocked by T-02.

## Resolution

Decided 2026-10-13 (user, live), following the fifth audit's T-07
precedent (`../../2026-10-13-arch-audit-findings/tickets/T-07-delivery-process.md`).
The audit asset serves as the plan for every direct batch.

- **B1 (F5, F7, F11): direct.** First, a pin test for F5. It asserts each
  site's message and its forwarded `suggestion`, as refined by T-01. Then
  `refactor`, then one `bug-hunt` + `qc` over the whole B1 diff. F7 and F11
  are test-only, so they get no separate pass; they ride in that one review.
- **B2 (F1-F4): direct.** First, pin tests for F2 (cursor reuse with a
  changed non-paging arg fails `INVALID_CURSOR`; extend the existing pin at
  `outbound-regressions.test.ts` if it already covers this) and for F3
  (accepted/skipped/cancelled outcome per tool, where not already pinned).
  Then `refactor`, then `bug-hunt` + `qc`.
- **B3 (F6 + `sensitive.ts` anchor): planned.** `write-plan`, `plan-hunt`,
  `run-plan`, then `bug-hunt` + `qc`. Why: the `sensitive.ts`
  trailing-dots/spaces trim swap is adjacent to the guard.
- **B4 (F8, F9, F10 remainder): direct.** `refactor` for F9, with
  `bug-hunt` + `qc` scoped to the F9 code. Text-only edits (F8, F10) need
  no `bug-hunt`. Each one is verified by grepping that every cited symbol
  or path exists. `npm run check` stays green.

Material uncertainty: none.

Redraw: T-04..T-07 unaffected. Their Question already defers to this
ticket's chain. No fog; nothing out of scope.
