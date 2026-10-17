---
kind: frontier-ticket
id: T-06
title: Deliver batch B3: F6 and the sensitive.ts anchor
map: M-01
status: closed
type: task
mode: hitl
priority: 100
blocked_by: [T-03, T-05]
claimed:
---

## Question

Batch B3 (primitives): F6 homes (`CHAR_COLON` + trim exported from `path-utils.ts`, `toPosixRelative` to `path-utils.ts`, `parseTrueEnvFlag` to `util.ts`, `splitDirList` decided or recorded, both headers fixed) plus F10's `sensitive.ts` stale `getReservedDeviceName (path.ts)` anchor, swapped to a symbol name. Branches after B2 merges; import lines in list/find-files/search-text/`path.ts` were touched by B2.

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
[#83](https://github.com/j0hanz/filesystem-mcp/pull/83), merged as
`7df3f33e` on the user's confirmation.

Chain (T-03, planned): [`b3-primitives.plan.md`](../b3-primitives.plan.md)
was written at `cd242a8c`. [`b3-primitives.plan-hunt.md`](../b3-primitives.plan-hunt.md)
found it clean. [`b3-primitives.run.md`](../b3-primitives.run.md) logged all
5 steps done and every Done box passed. `bug-hunt` and `qc` found nothing.

- **F6:**
  - `CHAR_COLON` and `trimTrailingDotsAndSpaces` are exported from
    `path-utils.ts`. Their duplicates in `sensitive.ts` are deleted.
  - `getReservedDeviceName` now uses the shared trim, and the trim's
    rationale lives on the function once.
  - `parseTrueEnvFlag` moved to `util.ts`. Its callers in `cli.ts`, `path.ts`,
    `sensitive.ts` and `http.ts` now import it from there.
  - `toPosixRelative` moved to `path-utils.ts`. Its four tool callers now
    import it from there.
  - The `sensitive.ts` header no longer lists the primitives it shares, so
    it cannot drift.
  - `splitDirList` is recorded as staying in `path-utils.ts`: it is a
    path-list primitive that splits on the platform delimiter.
- **F10 (`sensitive.ts` anchor):** the stale `getReservedDeviceName (path.ts)`
  cite now names `trimTrailingDotsAndSpaces`, a grep-able symbol.

Completion check: `npm run check` exited 0, with 698 tests: 693 pass, 0 fail,
5 skipped (Windows). CI on the PR passed on ubuntu-latest and
windows-latest, plus CodeQL.

Net line delta: `src/` +61 / -52 (+9). Prettier wrapping two import lists
adds 16 lines; without them the delta is -7. The audit estimated about -2.

Material uncertainty: none.

Redraw: T-07 unaffected. B4 branches from `7df3f33e`, and its ADR anchors are
read against this tree.
