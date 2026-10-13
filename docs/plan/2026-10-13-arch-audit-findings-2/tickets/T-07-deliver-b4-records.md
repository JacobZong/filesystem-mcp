---
kind: frontier-ticket
id: T-07
title: Deliver batch B4: F8, F9, F10 remainder
map: M-01
status: closed
type: task
mode: hitl
priority: 100
blocked_by: [T-03, T-06]
claimed:
---

## Question

Batch B4 (records): F8 false subscribe-gate sentence deleted in `resources.ts` plus dated ADR-003 amendment; F9 `readOnly` normalized once in `server.ts`, registrar field typed `boolean`, three `?? false` deleted; F10 remaining anchors (`http-policy.ts` `parseAllowedHostsEnv` doc, ADR-001/002/003) swapped to grep-able symbol names where a symbol exists (T-02). Anchors are read only after B2 and B3 land, since they cite `move.ts`, `http.ts`, `resources.ts`.

Deliver under the map's execution contract
([map](../arch-audit-findings-2.map.md)): the moves in
[audit findings](../assets/audit-findings.md) as refined by
[T-01](T-01-behaviour-acceptance.md) and
[T-02](T-02-batching-merge-order.md), following the chain
[T-03](T-03-delivery-process.md) settles for this batch. Re-grep every site
before editing; grep every caller of a touched function before dispatch.
Commit, push and merge only on the user's go-ahead. Resolution records
`npm run check` result (test counts), net line delta, PR link.

## Resolution

Delivered 2026-10-13 under the execution contract. PR
[#84](https://github.com/j0hanz/filesystem-mcp/pull/84) merged as
`232bf19f` on the user's confirmation.

- **F9:** `server.ts` deps carry `readOnly: options.readOnly ?? false`. The
  registrar deps in `tools/index.ts`, `prompts.ts` and `resources.ts` type
  the field as `boolean`. The three `?? false` fallbacks are deleted, and
  `ResourceRegistrarDeps` no longer omits and re-adds `readOnly`. Default
  owners went from 4 to 1. No test edits: the one direct test caller already
  passes `readOnly: false`.
- **F8:** the false "registered if and only if `resources.subscribe` is
  advertised" sentence is deleted from `resources.ts`. ADR-003 gains an
  `Amended 2026-10-13` bullet recording the implemented gate
  (`era !== 'modern' && !legacyHttp`). The bullet names `TC-FUNC-059` as the
  one in-repo era-omitted + notifier shape, and records that a modern
  instance advertises `subscribe` without registering a handler.
- **F10, remainder:**
  - ADR-001 (7), ADR-002 (3) and ADR-003 (2) line anchors are swapped to
    symbol names.
  - ADR-001's `DEFAULT_EXCLUDE_PATTERNS` reference now notes the current name
    `DEFAULT_EXCLUDED_NAMES`.
  - The ADR-001 guard is re-anchored to the `filter.isExcluded` re-check in
    `processGlobPattern`. This is a `qc` finding: the old anchor and my first
    swap both named the `createWalkFilter` call site, which holds no guard.
  - The `http-policy.ts` `computeAllowedOriginHostnames` doc no longer cites
    the nonexistent `parseAllowedHostsEnv`. It states the real contrast
    (all-blank origins are configured-empty; all-blank `FS_ALLOWED_HOSTS` is
    unset).
  - ADR-002's `instructions.ts:67` anchor was re-checked and is still
    correct, so it was left alone.

Chain (T-03, direct): `refactor` for F9, then `bug-hunt` (F9 code, 0
findings) and `qc` (F9 plus a fact check of every record edit, 1 Minor,
verified and fixed). The text edits were verified by grepping the 21 cited
symbols: all present.

Completion check: `npm run check` exited 0. Of 698 tests, 693 passed, 0 failed
and 5 were skipped (Windows). PR CI passed on windows-latest and CodeQL. The
first ubuntu-latest run failed one test ("subscribe -> file modification ->
notification -> unsubscribe", `resources-subscribe.test.ts`: no
`notifications/resources/updated` within 5000ms). A re-run of the failed job
passed. Net line delta: `src/` +11 / -13 (-2); ADRs +29 / -21.

Material uncertainty: none for this batch. The ubuntu failure is outside B4's
change (the subscribe gate does not read `readOnly`), and the re-run passed.
It is unproven as a flake, so it is noted here, not ticketed. A repeat belongs
to the testing audit's flake work (`docs/plan/2026-10-12-*`), not this map.

Redraw: no open tickets remain.
