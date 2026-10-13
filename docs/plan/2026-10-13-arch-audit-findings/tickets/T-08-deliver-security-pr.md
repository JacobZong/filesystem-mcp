---
kind: frontier-ticket
id: T-08
title: Deliver the finding 1 read-path security PR
map: M-01
status: in-progress
type: task
mode: afk
priority: 20
blocked_by: ["T-09"]
claimed: 2026-10-13T13:05:00Z
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
