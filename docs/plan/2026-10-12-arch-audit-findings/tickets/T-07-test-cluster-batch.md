---
kind: frontier-ticket
id: T-07
title: Deliver the test-cluster batch (findings 2 and 3)
map: M-01
status: closed
type: task
mode: afk
priority: 60
blocked_by: ["T-02", "T-04"]
claimed:
---

## Question

Deliver the test-cluster batch from
[audit findings](../../assets/audit-findings.md): findings 2 (dissolve
`high-severity-fixes.test.ts` into `tools.test.ts`, `core-fs.test.ts` and
`stdio.test.ts`) and 3 (`modernClientMeta` in `helpers.ts`, applied at the
five stamp sites: `stdio.test.ts` twice, `input-required.test.ts`,
`cli.test.ts`, `http-server.test.ts`). Both touch `stdio.test.ts`, so they
land in one PR; no production files change. The delivery follows the
process T-02 settles for this batch, the PR merges in the order T-04
settles, and completion follows the map's execution contract.

Priority 60: last in the risk-ascending merge chain T-04 settled — the
most rebase-sensitive batch merges on the final base.
## Resolution

Delivered, 2026-10-13, via
[PR #79](https://github.com/j0hanz/filesystem-mcp/pull/79), merged to
`main` as `fae51c54` with the user's go-ahead (merge slot 7 of 7, last).

- Finding 2: `high-severity-fixes.test.ts` is deleted. H2, H3, H1 and
  H1+H6 moved into a new suite in `tools.test.ts` with its own root;
  H4 moved to `core-fs.test.ts` and H5 to `stdio.test.ts`, verbatim.
  All 15 tests kept their assertions.
- Finding 3: `modernClientMeta(name, capabilities)` in `helpers.ts`
  uses the SDK meta-key constants and `MODERN_PROTOCOL_REVISION`. All 5
  stamp sites use it.
- Completion check:
  - `npm run check` exits 0: 677 tests (unchanged), 672 pass,
    5 skipped.
  - CI is green on all 6 checks.
  - Tests net line delta: +552 / -556.
- Accepted: `core-fs.test.ts` (1,053 lines) and `stdio.test.ts` (1,043
  lines) cross 1,000 lines because they took the moved suites. The
  audit's estimate of about -55 did not hold, because the tools suite
  needs its own isolated root.
- Process (T-02, direct): refactor, then one combined review (approved;
  the misplaced doc comment and the SDK constants were applied).
