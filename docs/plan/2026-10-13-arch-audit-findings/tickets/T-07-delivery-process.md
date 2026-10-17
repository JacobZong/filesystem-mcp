---
kind: frontier-ticket
id: T-07
title: Which delivery process does each batch follow?
map: M-01
status: closed
type: grilling
priority: 100
blocked_by: ["T-05"]
claimed:
---

## Question

For each of the four batches, which process applies: singles {2, 6,
13}, tool code {3, 7, 8, 9, 14}, guard {4, 12, 15}, transport {5, 10,
11}?

- Direct edit: a test pin first where behaviour changes, `refactor`
  otherwise, then `bug-hunt` and `qc`.
- Planned: `write-plan`, then `plan-hunt`, then `run-plan`, then
  `bug-hunt` and `qc`.

## Resolution

Confirmed with the user, 2026-10-13: a mixed process.

- **Singles {2, 6, 13}: direct.** `refactor` (no behaviour change), then
  `bug-hunt` and `qc`. [audit findings](../assets/audit-findings.md)
  serves as the plan.
- **Tool code {3, 7, 8, 9, 14}: direct.** First a test pin for finding
  8's merged wording, then `refactor` for the rest, then `bug-hunt` and
  `qc`.
- **Guard {4, 12, 15}: planned.** `write-plan`, `plan-hunt`, `run-plan`,
  then `bug-hunt` and `qc`. The plan carries finding 12's wrapped guard
  call, finding 15's empty-boundary return, and finding 15's pin test,
  which lands first.
- **Transport {5, 10, 11}: planned.** Same chain. The plan is written
  only after the 2026-10-12 map's resources.ts batch merges, so it is
  written against the `voidSend` code.

Why: the two planned batches change path-security semantics or rebase
across maps. The direct ones are local moves whose behaviour is pinned or
unchanged.
