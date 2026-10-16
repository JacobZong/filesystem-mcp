---
kind: frontier-ticket
id: T-17
title: Batch A follow-up premise - who depends on GuardedFileSystem.stat following symlinks, and how should the stat bind to the validated file?
map: M-01
status: open
type: research
mode: afk
priority: 100
blocked_by: []
claimed:
---

## Question

Triggered by the Codex finding on PR #106: `GuardedFileSystem.stat`
(`src/core/fs.ts:173-180`) validates the path, then calls plain `fsStat(validPath)`
with no descriptor binding, so a final symlink swap after validation can size a
target outside the allowed roots. Which callers depend on the current
follow-symlink semantics, and what fd-bound shape fits? Unblocks
[the follow-up delivery](T-18-deliver-batch-a-followup-fd-stat.md).

## Research context

- Unblocks: batch A follow-up delivery (T-18) — an fd-bound stat in
  `GuardedFileSystem.stat`, the same class the H4 fix gave every read path.
- Starting sources: `src/core/fs.ts:173-180` (`stat`), `fs.ts` H4 machinery —
  `#openVerified` (O_NOFOLLOW open), `#assertFdWithinRoots`, `#abandonOnAbort`
  (release-on-abort pattern); the fifth audit's H4 fix record
  (`docs/plan/2026-10-13-arch-audit-findings/read-path-h4.plan.md`, which also
  fd-bound `countFileLines` — metadata counts under the repo's own bar).
- Scope and evidence: enumerate EVERY `GuardedFileSystem.stat` caller (grep
  `fs.stat(`/`ctx.fs.stat` across `src/`), and for each, whether it needs
  follow-symlink stats or already refuses symlinks upstream; propose the
  fd-bound shape (O_NOFOLLOW open + fstat + `#assertFdWithinRoots`, or
  `fstatat`) and name each caller's behavior change; check both refuted lists
  and the H4 plan's constraints. Cite `file:line` for every claim. A design
  that breaks any caller's contract is a failed return.
