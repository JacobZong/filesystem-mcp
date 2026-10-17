---
kind: frontier-ticket
id: T-09
title: Which delivery process does the finding 1 security PR follow?
map: M-01
status: closed
type: grilling
priority: 20
blocked_by: []
claimed:
---

## Question

The finding 1 PR (scope settled by
[Does finding 1 ship as a security fix, separately and first?](T-03-security-fix-first.md))
crosses about 6 files: `core/fs.ts`, `core/read.ts`, `core/search.ts`,
`tools/read.ts`, `tools/search-text.ts`, `tools/create.ts`, plus tests.
It also changes `searchContent`'s signature. Which process does it follow?

- Planned: `write-plan`, then `plan-hunt`, then `run-plan`, then
  `bug-hunt` and `qc`.
- Direct: `tdd` (regression tests first), then `bug-hunt` and `qc`.

Priority 20: the security PR merges before everything else.

## Resolution

Confirmed with the user, 2026-10-13: the planned process.

1. `write-plan`: the plan lands in this effort directory.
2. `plan-hunt`: hunt the plan for dead steps.
3. `run-plan`: execute it, regression tests first.
4. `bug-hunt` and `qc` on the branch before the merge.

Why: about 6 source files plus tests, a signature change to
`searchContent`, and a security path. Plan lists in this repo have
dropped call sites before, and `plan-hunt` is the check for that.
