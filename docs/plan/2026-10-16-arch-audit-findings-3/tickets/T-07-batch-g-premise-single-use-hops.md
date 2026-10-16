---
kind: frontier-ticket
id: T-07
title: Batch G premise - are the three single-use hops still single-use?
map: M-01
status: closed
type: research
mode: afk
priority: 100
blocked_by: []
claimed:
---

## Question

Do finding 9 and finding 10 of [the audit asset](../assets/audit-findings.md)
hold live: are `validateDirectoryPath`, `normalizeAndValidateDirs`, and
`resolveNamedRootContext` still single-caller hops whose deletion loses
nothing? Unblocks [batch G delivery](T-14-deliver-batch-g-middlemen.md).

## Research context

- Unblocks: batch G delivery (T-14) — fold the hops into their sole callers.
- Starting sources: `src/cli.ts:62` (`validateDirectoryPath`, audit's sole
  caller `:89`), `src/cli.ts:83` (`normalizeAndValidateDirs`, sole caller
  `:210`); `src/core/path-completer.ts:43` (`resolveNamedRootContext`, sole
  caller `:153`).
- Scope and evidence: grep every reference to each of the three names across
  `src/` and `__tests__/`; confirm single-use in production and that no test
  imports them directly (a direct test import changes the fold). For each,
  apply the middleman check: inline in your head and confirm no rule
  reappears. Check both refuted lists (the 2026-10-02 refuted
  `path-completer resolveRealPath` is a different symbol; confirm). Cite
  `file:line` for every claim. A second caller is a failed return.

## Resolution

LIVE. All three hops are module-private with one production caller each
(`cli.ts:89`, `cli.ts:210`, `path-completer.ts:153`) and zero test references
across `__tests__/`. Middleman check passes for all three — nothing
reappears when inlined. Cascade note for batch G: `findAllowedRootByName`
(`path-completer.ts:38`) has `resolveNamedRootContext`'s call at `:49` as its
only caller — after the fold it becomes single-use; inline it too or leave
deliberately, and flag the choice in the PR. `resolveRealPath` confirmed a
different symbol (`path.ts:135`, guard-batch removed it from path-completer).
No refuted-list collision.

Material uncertainty: none.
