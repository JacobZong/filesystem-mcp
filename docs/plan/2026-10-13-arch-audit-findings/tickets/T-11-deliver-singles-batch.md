---
kind: frontier-ticket
id: T-11
title: Deliver the singles batch (findings 2, 6, 13)
map: M-01
status: closed
type: task
mode: afk
priority: 10
blocked_by: ["T-06", "T-07"]
claimed:
---

## Question

Deliver findings 2, 6 and 13 from [audit findings](../assets/audit-findings.md)
in one PR touching `src/tools/define.ts`, `src/tools/index.ts`,
`src/core/errors.ts` and `docs/adr/002-legacy-protocol-paths-sunset.md`.

13 lands as an "Amended 2026-10-13" line
([Are the visible behavior changes acceptable?](T-04-behaviour-acceptance.md)).

Follow the process T-07 settles and the merge slot T-06 settles.
Completion follows the map's execution contract.

Priority 10: merge slot 1 of 7 (T-06).

## Resolution

Delivered, 2026-10-13, via
[PR #73](https://github.com/j0hanz/filesystem-mcp/pull/73), merged to
`main` as `f6b890cc` with the user's go-ahead (merge slot 1 of 7).

- Completion check (the execution contract):
  - Finding 2: `ToolRegistrarDeps extends ToolDeps`, and `deps` passes
    straight through.
  - Finding 6: all three sites go through `build()`.
  - Finding 13: ADR-002 has an "Amended 2026-10-13" line.
  - `npm run check` exits 0: 672 tests, 667 pass, 5 skipped.
  - CI is green on all 6 checks.
- `src/` net line delta: +10 / -41.
- Process (T-07, direct): refactor, then bug-hunt (no findings), then qc
  (approved, nothing blocking).
