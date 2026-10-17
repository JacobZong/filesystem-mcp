---
kind: frontier-map
id: M-01
title: Fix the sixth architecture audit's 11 findings
status: closed
created: 2026-10-13T10:47:07Z
---

## Destination

All 11 findings from [the sixth audit findings](assets/audit-findings.md) are
on `main`. Each one lands as the move the asset states, refined by this map's
decision tickets, in batch PRs merged with `npm run check` green.

## Notes

- Scope source: [audit findings](assets/audit-findings.md), audited at
  `4153e7e0` (post-PR #80), every finding adversarially verified; the asset's
  site lists and move revisions supersede any older prose. Line numbers
  drift, so re-grep before every edit.
- Do-not-re-hunt: the asset's Refuted and Decisions-to-reopen sections carry
  standing records. No ticket or plan may re-propose them.
- Skills every session consults: `grilling` for decision tickets. Delivery
  follows the chain the delivery-process ticket settles.
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

- [Are the two behavior deltas acceptable as stated?](tickets/T-01-behaviour-acceptance.md)
  — F2 accepted as stated; F5 narrowed: each `read.ts` site forwards its own
  remedy as the `FsError` `suggestion` instead of dropping it.
- [How do the 11 findings batch into PRs, and in what order do they merge?](tickets/T-02-batching-merge-order.md)
  — four batches in one chain: B1 F5+F7+F11, B2 F1-F4, B3 F6 + F10's
  `sensitive.ts` anchor, B4 F8+F9+F10 rest; F10 anchors become symbol names.
- [Which delivery chain does each batch follow?](tickets/T-03-delivery-process.md)
  — B1, B2, B4 direct with pin tests first (F5; F2, F3); B3 planned; text-only
  edits verified by symbol grep, no `bug-hunt`.
- [Deliver batch B1: F5, F7, F11](tickets/T-04-deliver-b1-isolated.md)
  — delivered in PR #81 (`f4124ef2`); `npm run check` 676/0/5; net +37.
- [Deliver batch B2: F1, F2, F3, F4](tickets/T-05-deliver-b2-tools.md)
  — delivered in PR #82 (`cd242a8c`); `npm run check` 693/0/5; `src/` net -8.
- [Deliver batch B3: F6 and the sensitive.ts anchor](tickets/T-06-deliver-b3-primitives.md)
  — delivered in PR #83 (`7df3f33e`) via plan, hunt, run; 693/0/5; `src/` +9 (imports).
- [Deliver batch B4: F8, F9, F10 remainder](tickets/T-07-deliver-b4-records.md)
  — delivered in PR #84 (`232bf19f`); 693/0/5; `src/` net -2; one ubuntu re-run.

## Not yet specified

## Out of scope

- The record-backed reopen decisions in the asset's Decisions-to-reopen
  section — `write-adr` efforts only if their recorded triggers fire.
- Refuted candidates — the asset's do-not-re-hunt records stand.
- Untracked `exampels/` typo dir — local leftovers, not repo content.
- Releasing — a version bump runs through the Release workflow, on the user's
  call.
- The fifth audit's below-the-bar ponytail list — separate pass; this map's
  own below-bar list in the asset hands off the same way.

## Superseded

## Closure record

Closed 2026-10-13. All 7 tickets are closed, none is left `initializing`,
and **Not yet specified** is empty. All 11 findings from the sixth audit are
on `main`, in four merged batch PRs:

| Batch | Findings | PR | Merge | `npm run check` | `src/` net |
| :-- | :-- | :-- | :-- | :-- | :-- |
| B1 | F5, F7, F11 | [#81](https://github.com/j0hanz/filesystem-mcp/pull/81) | `f4124ef2` | 676/0/5 | -3 (tests +40) |
| B2 | F1-F4 | [#82](https://github.com/j0hanz/filesystem-mcp/pull/82) | `cd242a8c` | 693/0/5 | -8 (tests +175) |
| B3 | F6, F10 (sensitive.ts) | [#83](https://github.com/j0hanz/filesystem-mcp/pull/83) | `7df3f33e` | 693/0/5 | +9 (16 import-wrap) |
| B4 | F8, F9, F10 rest | [#84](https://github.com/j0hanz/filesystem-mcp/pull/84) | `232bf19f` | 693/0/5 | -2 |

Execution-contract evidence lives in each task ticket's Resolution (T-04 to
T-07).

Deviations from the asset's stated moves are recorded in those Resolutions:
- F11 imports the revision constant directly, not through a re-export.
- F2 uses a key helper rather than a `paginate` signature change, and sorts
  its entries.
- F1 in `move.ts` folds the guarded stat into `validateTransferSource`.
- F5 forwards each site's remedy as `suggestion` (T-01).

Next handoff: none required. Nothing is left to decide or plan. The two
calls left are both the user's:
- Releasing goes through the Release workflow, on the user's call.
- A recurrence of the ubuntu `resources-subscribe` timeout (T-07) would go to
  the testing audit's flake work.

No `write-adr` handoff: the one record this map touched (ADR-003) was
amended in place.

