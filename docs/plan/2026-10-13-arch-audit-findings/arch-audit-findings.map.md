---
kind: frontier-map
id: M-01
title: Fix the 2026-10-13 architecture audit findings
status: closed
created: 2026-10-13T00:00:00Z
---

## Destination

All 15 findings from the 2026-10-13 architecture audit are on `main`.
Each one lands as the move [audit findings](assets/audit-findings.md)
states, refined by this map's decision tickets, in batch PRs merged with
`npm run check` green.

## Notes

- Scope source: [audit findings](assets/audit-findings.md), audited at
  `1bc6b791`. Line numbers drift, so re-grep before every edit.
- Sibling effort:
  [Fix the 2026-10-12 architecture audit findings](../2026-10-12-arch-audit-findings/arch-audit-findings.map.md)
  is still open (its findings 1-6 and 9). Shared ground with it:
  - `src/core/fs.ts` `readLeadingSample`: this map's finding 1 and its
    finding 9.
  - That map's finding 9 moved into this map's finding 1 PR (T-03). Its
    core singles batch ticket (T-05 there) still names finding 9 in its
    title; its next session narrows the delivery to findings 1 and 6.
  - `src/server.ts` and `src/transport/stdio.ts`: this map's findings 10
    and 11 and its finding 5.
- Skills every session consults: `grilling` for decision tickets. For
  delivery, use the process the delivery-process ticket settles: `tdd` or
  `refactor`, then `bug-hunt` and `qc`; or `write-plan`, `plan-hunt` and
  `run-plan`.
- Standing preferences:
  - Never hand-edit versions (`AGENTS.md`).
  - The release type is the user's call.
  - Grep every caller of a touched function before dispatch.
  - Commits, pushes and merges need the user's go-ahead.

### Execution contract

- Scope: the move each finding states in
  [audit findings](assets/audit-findings.md), as refined by this map's
  decision tickets, and nothing beyond it.
- Completion: the stated move is present in the diff, `npm run check` exits
  0, and the batch PR carrying it is merged to `main` with the user's
  confirmation.
- Evidence: the task ticket's Resolution records the `npm run check` result
  (test counts), the net line delta, and the PR link.

## Decisions so far

- [Is the H4 bypass real on all three read paths, and what test pins it?](tickets/T-01-h4-bypass-facts.md) — Real: scanFile leaks content on every OS; the read known branch and readLeadingSample leak via ancestor swap on Linux; countFileLines is a fourth path; local attacker only.
- [What exactly changes in behavior for findings 3, 10, 12 and 15?](tickets/T-02-behaviour-deltas.md) — 3 breaks nothing; 10 changes only modern stdio with FS_API_KEY; 12 hides sensitive-named dirs and must catch guard throws; 15 grants a missing seeded root via a symlinked boundary and must keep the empty-boundary return.
- [Does finding 1 ship as a security fix, separately and first?](tickets/T-03-security-fix-first.md) — Yes: own PR, merged before every other batch of both maps, CHANGELOG Security entry and no advisory. Scope adds countFileLines and the old map's finding 9. Tests: flipper plus a Linux-only ancestor swap.
- [Which delivery process does the finding 1 security PR follow?](tickets/T-09-security-pr-process.md) — Planned: write-plan, plan-hunt, run-plan, then bug-hunt and qc before merge.
- [Deliver the finding 1 read-path security PR](tickets/T-08-deliver-security-pr.md) — Delivered: PR #72 merged as 989b4e9b; check green (672 tests), Linux race tests ran; src net -27 lines.
- [Are the visible behavior changes acceptable?](tickets/T-04-behaviour-acceptance.md) — All accepted: 3 keeps the undefined key; 8 takes the shared wording; 10 stdio always public; 12 tightened with a wrapped guard; 13 by amendment line; 15 granted with a pin test first.
- [How are the 15 findings batched into PRs alongside M-01?](tickets/T-05-batching.md) — Four file-disjoint PRs: singles {2,6,13}, tool code {3,7,8,9,14}, guard {4,12,15}, transport {5,10,11}; the old map's finding 5 is not folded in.
- [In what order do the batches merge relative to M-01?](tickets/T-06-merge-order.md) — One chain over both maps: singles, old core singles, tool code, guard, old resources.ts, transport, old test cluster last.
- [Which delivery process does each batch follow?](tickets/T-07-delivery-process.md) — Mixed: singles and tool code go direct (pin, refactor, bug-hunt, qc); guard and transport are planned (write-plan, plan-hunt, run-plan, bug-hunt, qc).
- [Deliver the singles batch (findings 2, 6, 13)](tickets/T-11-deliver-singles-batch.md) — Delivered: PR #73 merged as f6b890cc (slot 1); check green, src net -31 lines.
- [Deliver the tool-code batch (findings 3, 7, 8, 9, 14)](tickets/T-12-deliver-tool-code-batch.md) — Delivered: PR #75 merged (slot 3); check green, contract unchanged, src net -111 lines.
- [Deliver the guard batch (findings 4, 12, 15)](tickets/T-10-deliver-guard-batch.md) — Delivered: PR #76 merged (slot 4); premises reproduced red first; src net -51 lines; grants now stricter on outside-pointing links.
- [Deliver the transport batch (findings 5, 10, 11)](tickets/T-13-deliver-transport-batch.md) — Delivered: PR #78 merged (slot 6); the API key stops at the HTTP host; public exports unchanged; src net -10.

## Not yet specified

_None._

## Out of scope

- QC follow-up from the finding 1 PR: open every read through
  `GuardedFileSystem.open`. That would pass `readFileWithStats` the
  handle, delete `openReadableFileHandle` and the `verifyHandle` lambdas,
  and fold `readRaw`'s duplicate open. Ruled out of scope by the user on
  2026-10-13. It sits outside the execution contract and is not one of
  the 15 findings. It drops the abort-on-open race and saves about 20
  lines. It is left for a later refactor or ponytail pass. See
  [`read-path-h4.run.md`](read-path-h4.run.md).
- Reopening ADR-001 so `globEntries` resolves `ignoreCeiling` itself. The
  2026-09-28 amendment blesses per-caller ceilings; that needs a
  `write-adr` effort of its own.
- The below-the-bar cut list and the unverified Windows segment-order
  claim in [audit findings](assets/audit-findings.md). These are ponytail
  and bug-hunt hand-offs.
- Releasing. A version bump runs through the Release workflow, on the
  user's call.

## Superseded

## Closure record

Closed 2026-10-13. All 13 tickets are closed, none is initializing, and
Not yet specified is empty. All 15 findings are on `main`.

| Slot | PR | Findings |
| :--- | :--- | :--- |
| security | #72 | 1 (plus the 2026-10-12 map's finding 9) |
| 1 | #73 | 2, 6, 13 |
| 3 | #75 | 3, 7, 8, 9, 14 |
| 4 | #76 | 4, 12, 15 |
| 6 | #78 | 5, 10, 11 |

Slots 2, 5 and 7 belonged to the 2026-10-12 map (PRs #74, #77 and #79),
which closed the same day.

- Execution-contract evidence: each delivery ticket's Resolution records
  its `npm run check` counts, net line delta and PR link. `src/` shrank
  in every batch: -27, -31, -111, -51 and -10 lines.
- Next handoff: none required. Releasing is the user's call, through the
  Release workflow. The ADR-001 ceiling reopen and the QC follow-up are
  under Out of scope, should either be wanted.
