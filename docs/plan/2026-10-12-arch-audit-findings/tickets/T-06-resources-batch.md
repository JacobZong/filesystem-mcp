---
kind: frontier-ticket
id: T-06
title: Deliver the resources.ts batch (findings 4 and 5)
map: M-01
status: closed
type: task
mode: afk
priority: 50
blocked_by: ["T-02", "T-04"]
claimed:
---

## Question

Deliver the resources.ts batch from
[audit findings](../../assets/audit-findings.md): findings 4
(`registerResources` delegates to `getResourceContracts`) and 5 (the
`voidSend` notify helper in `core/observability.ts`, shrinking the three
call sites in `stdio.ts`, `resources.ts` and `server.ts`). Both touch
`resources.ts`, so they land in one PR; no visible behaviour changes. The
delivery follows the process T-02 settles for this batch, the PR merges in
the order T-04 settles, and completion follows the map's execution
contract.

Priority 50: third in the risk-ascending merge chain T-04 settled.
## Resolution

Delivered, 2026-10-13, via
[PR #77](https://github.com/j0hanz/filesystem-mcp/pull/77), merged to
`main` as `5efb4a1d` with the user's go-ahead (merge slot 5 of 7 in the
cross-map chain).

- Finding 4: `getResourceContracts` returns a typed tuple, and
  `registerResources` registers that list (the file contract is
  `[2]`, typed `SubscribableContract`).
- Finding 5: `voidSend` in `core/observability.ts` replaces the three
  catch-and-log sites. The list-changed debug line now uses
  `formatUnknownErrorMessage`, like the other two.
- Completion check:
  - `npm run check` exits 0: 676 tests, 671 pass, 5 skipped.
  - CI is green on all 6 checks.
  - `src/` net line delta: +23 / -29 (-6). The first cut was net +1; the
    helper was trimmed to clear the net-deletion bar.
- Process (T-02, direct): refactor, then one combined bug-hunt and qc
  review (approved, nothing blocking).
