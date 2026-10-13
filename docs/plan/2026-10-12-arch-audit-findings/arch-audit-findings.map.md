---
kind: frontier-map
id: M-01
title: Fix the 2026-10-12 architecture audit findings
status: closed
created: 2026-10-12T00:00:00Z
---

## Destination

All 9 findings from the 2026-10-12 architecture audit are on `main`.
Findings 1–9 change code or tests per the move each one states in
[audit findings](assets/audit-findings.md). They land in batches grouped by
shared file, each merged with `npm run check` green.

## Notes

- Scope source: [audit findings](assets/audit-findings.md), audited at
  `cf6383cd`. Line numbers drift, so re-grep before every edit.
- Skills every session consults: `grilling` for decision tickets, then the
  delivery process the process decision settles (`tdd` or `refactor`, then
  `bug-hunt` and `qc`, for direct batches; `write-plan`, `plan-hunt` and
  `run-plan` for planned ones).
- Standing preferences:
  - Never hand-edit versions (`AGENTS.md`).
  - The release type is the user's call.
  - Grep every caller of a touched function before dispatch.
  - Commits and pushes need the user's go-ahead, and so does every merge.
- Shared-file overlaps that drive batching:
  - `src/resources.ts`: findings 4 and 5
  - `__tests__/stdio.test.ts`: findings 2 and 3
  - `__tests__/helpers.ts` + `input-required.test.ts` + `cli.test.ts`:
    finding 3
  - `__tests__/tools.test.ts` + `core-fs.test.ts`: finding 2

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

- [How should the 9 audit findings be batched into PRs?](tickets/T-01-batch-the-findings.md) — Four PRs: {4,5} resources.ts, {2,3} test cluster, {1,6,9} core singles, {7,8} tool singles; disjoint singletons fold by zone, halving the precedent's merge count.
- [Which delivery process does each batch follow?](tickets/T-02-delivery-process.md) — Direct edit for all four: test pin first where a visible behaviour changes, refactor otherwise, then bug-hunt and qc before each merge; audit-findings.md is the plan.
- [Are the two visible behaviour changes acceptable?](tickets/T-03-behaviour-acceptance.md) — Both accepted: the near-cap too-large-to-cache refusal at externalization, and replace_text adopting the owner's TOO_LARGE wording.
- [In what order do the batch PRs merge?](tickets/T-04-merge-order.md) — Fixed risk-ascending chain: tool singles, core singles, resources.ts, test cluster last; batches are file-disjoint, only CHANGELOG text rebases.
- [Deliver the tool singles batch (findings 7 and 8)](tickets/T-08-tool-singles-batch.md) — Delivered: PR #63 merged as b1d96f99 on 2026-10-12; closed at the 2026-10-13 recovery.
- [Deliver the core singles batch (findings 1, 6, 9)](tickets/T-05-core-singles-batch.md) — Delivered: PR #74 ships finding 6; finding 1 refuted at delivery (stdio store already capped); finding 9 shipped in PR #72.
- [Deliver the resources.ts batch (findings 4 and 5)](tickets/T-06-resources-batch.md) — Delivered: PR #77 merged (slot 5); voidSend owns best-effort notifies, the registrar uses getResourceContracts; src net -6.
- [Deliver the test-cluster batch (findings 2 and 3)](tickets/T-07-test-cluster-batch.md) — Delivered: PR #79 merged (slot 7, last); high-severity pool dissolved, modernClientMeta at 5 sites; test count unchanged.

## Not yet specified

_None._ The per-batch delivery tickets graduated into T-05 through T-08
in the T-01 redraw.

## Out of scope

- Releasing these changes. A version bump runs through the Release
  workflow, on the user's call.
- Re-proposing the refuted candidates in
  [audit findings](assets/audit-findings.md); each one was priced against
  the four gates and died on evidence.

## Superseded

## Closure record

Closed 2026-10-13. All batch tickets are delivered, and no ticket is
open or initializing. Not yet specified is empty.

- Findings 2, 3, 4, 5, 6, 7 and 8 are delivered:
  - PR #63 (tool singles: 7, 8)
  - PR #74 (core singles: 6)
  - PR #77 (resources.ts: 4, 5)
  - PR #79 (test cluster: 2, 3)
- Finding 9 shipped in PR #72, folded into the 2026-10-13 map's
  security fix.
- Finding 1 was refuted at delivery: stdio's store already capped
  read-backs. It is recorded in [audit findings](assets/audit-findings.md).
- Evidence: each task ticket's Resolution, with its `npm run check`
  counts, net line delta and PR link.
- Next handoff: none. Releasing is the user's call, through the Release
  workflow.
