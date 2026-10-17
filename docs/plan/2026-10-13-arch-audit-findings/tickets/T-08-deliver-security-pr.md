---
kind: frontier-ticket
id: T-08
title: Deliver the finding 1 read-path security PR
map: M-01
status: closed
type: task
mode: afk
priority: 20
blocked_by: ["T-09"]
claimed:
---

## Question

Deliver finding 1 from [audit findings](../assets/audit-findings.md), as
[Does finding 1 ship as a security fix, separately and first?](T-03-security-fix-first.md)
widened it:

- every read path goes through `GuardedFileSystem`: `scanFile`, the
  `tools/read.ts` known-stats branch, `readLeadingSample` and
  `countFileLines`;
- `readFileWithStats` is no longer exported, and `verifyHandle` becomes
  required;
- `readLeadingSample` drops its `size` parameter (2026-10-12 map,
  finding 9);
- add the regression tests T-03 names;
- add a CHANGELOG `[Unreleased]` `### Security` entry.

Follow the process T-09 settles. The PR merges first, ahead of every
other batch of both maps. Completion follows the map's execution
contract.

Priority 20: the security PR merges before everything else.

## Resolution

Delivered, 2026-10-13, via
[PR #72](https://github.com/j0hanz/filesystem-mcp/pull/72), merged to
`main` as `989b4e9b` with the user's go-ahead.

- Completion check (the execution contract):
  - The move is in the diff: every read path (`scanFile`, batch `read`,
    `readLeadingSample`, `countFileLines`) opens through
    `GuardedFileSystem`, and `readFileWithStats` requires a handle check.
  - `npm run check` exits 0 locally: 672 tests, 667 pass, 5 skipped.
  - CI is green on both legs. The Linux leg ran the final-component
    flipper and the new ancestor-swap test (672 tests, 666 pass, 6
    skipped).
  - Merged.
- `src/` net line delta: +59 / -86.
- Process (T-09): write-plan, plan-hunt (clean), run-plan, bug-hunt (one
  Minor, fixed: the CHANGELOG overclaimed on Windows), qc (finding 1
  fixed: `readFile`'s `known` parameter removed).
- Evidence: [run log](../read-path-h4.run.md),
  [hunt report](../read-path-h4.hunt.md),
  [plan-hunt report](../read-path-h4.plan-hunt.md).

Material uncertainty: qc findings 2 and 3 (unify every open through
`GuardedFileSystem.open`) are deferred; the map's Not yet specified
section records them.
