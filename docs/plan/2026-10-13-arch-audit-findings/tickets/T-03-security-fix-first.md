---
kind: frontier-ticket
id: T-03
title: Does finding 1 ship as a security fix, separately and first?
map: M-01
status: closed
type: grilling
priority: 20
blocked_by: ["T-01"]
claimed:
---

## Question

Given T-01's facts, how does finding 1 ship?

- As its own security-fix PR ahead of every other batch, with a CHANGELOG
  Security entry and possibly an advisory per `SECURITY.md`; or in a
  normal batch. Reach: `scanFile` leaks file content on every OS; the
  batch-read and append paths leak only through an ancestor swap on
  Linux; only a local process that can write inside a root can exploit
  any of them.
- Does its scope widen to the fourth path T-01 found (`countFileLines`
  at `src/core/fs.ts:89-90`, no validation and no fd check)?
- Does the 2026-10-12 map's finding 9 (`readLeadingSample` size param)
  fold into it?
- Which regression tests: the final-component flipper from
  `__tests__/high-severity-fixes.test.ts:327-409` only, or also a new
  Linux-only ancestor-swap variant?

Priority 20: the answer fixes the first batch and its process.

## Resolution

Confirmed with the user, 2026-10-13:

- **Shipping:** finding 1 ships as its own PR and merges before every
  other batch of this map and of the 2026-10-12 map. It gets a CHANGELOG
  `[Unreleased]` `### Security` entry, as #68 and H4 did. No GitHub
  advisory: the issue was found internally and only a local attacker can
  exploit it.
  - Basis: `SECURITY.md:39-40` counts a read outside the allowed folders
    "including through symlinks" as a vulnerability.
- **Scope:** widened to a fourth path, `countFileLines`
  (`src/core/fs.ts:89-90`), which also goes through `GuardedFileSystem`.
  Every read path T-01 found leaves the PR guarded.
- **Fold:** the 2026-10-12 map's finding 9 (drop `readLeadingSample`'s
  `size` parameter) moves into this PR, because the same function is
  rewritten anyway. That map's
  [core singles batch](../../2026-10-12-arch-audit-findings/tickets/T-05-core-singles-batch.md)
  then delivers findings 1 and 6 only. Its next session needs a pointer
  here; this session does not write that map.
- **Tests:**
  - Copy the final-component flipper
    (`__tests__/high-severity-fixes.test.ts:327-409`) for `scanFile` (via
    `searchContent`) and for the batch read (via `callTool`).
  - Add a new Linux-only ancestor-swap test that flips a directory
    between a real directory and a symlink to an outside one. It pins the
    batch read, `readLeadingSample` and `countFileLines`.

Material uncertainty: none beyond T-01's two open points (symlink dirents
in `fs.glob`, Windows junctions). Neither changes this decision.
