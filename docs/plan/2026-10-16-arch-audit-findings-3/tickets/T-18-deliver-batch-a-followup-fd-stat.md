---
kind: frontier-ticket
id: T-18
title: Deliver batch A follow-up - bind GuardedFileSystem.stat to the validated file
map: M-01
status: open
type: task
mode: afk
priority: 100
blocked_by: [T-17]
claimed:
---

## Question

Deliver the Codex finding's fix on PR #106, only after
[its premise](T-17-batch-a-followup-premise-fd-stat.md) resolved live and
named every caller's behavior change: give `GuardedFileSystem.stat`
(`src/core/fs.ts:173-180`) the same fd binding the read paths have — the
validated path is opened without following, the descriptor is re-checked
against the roots (`#assertFdWithinRoots`), and the size comes from the
re-checked descriptor. Pin test per the premise's design. No CHANGELOG
surface beyond a Security bullet extension if the premise names user-visible
refusals. Drift check first (`git diff 35c0daa0..HEAD -- src/core/fs.ts`);
a premise mismatch is a STOP. Own PR; contract completion check; resolution
links the PR.
