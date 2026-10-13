---
kind: frontier-ticket
id: T-05
title: Deliver batch B2: F1, F2, F3, F4
map: M-01
status: closed
type: task
mode: hitl
priority: 100
blocked_by: [T-03, T-04]
claimed:
---

## Question

Batch B2 (tools): F1 both raw stats onto `ctx.fs.stat`; F2 page-cache key built from args minus per-tool paging fields (loud `INVALID_CURSOR` accepted, T-01); F3 one verdict helper in `input-required.ts`; F4 inline `isEntryAccessible` into `list.ts`. Internal overlaps: `move.ts` (F1/F3), `list.ts` (F2/F4), `search-text.ts` (F1/F2).

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
[#82](https://github.com/j0hanz/filesystem-mcp/pull/82), merged as
`cd242a8c` on the user's confirmation.

- **F1:** `search-text.ts` `resolveSearchScope` uses `ctx.fs.stat`. In
  `move.ts`, `validateTransferSource` now runs one guarded `fs.stat` and
  returns `isDirectory`, so there is one resolution and one stat. That came
  from the `qc` finding: a call-site swap would have validated the source
  twice. Behavior edge: a non-`FsError` stat failure in that window now
  reports `ACCESS_DENIED`, as validation failures there already did. Aborts
  rethrow unchanged. Both raw `node:fs` stat imports are gone.
- **F2:** `pageQueryKey(method, args, pagingFields)` in `cursor.ts` builds
  the key with its entries sorted. The asset's other option was used (a
  helper, not a `paginate` signature change) to keep `paginate`'s explicit
  generics, which type-check each tool's page metadata. The sort came from
  the `bug-hunt` finding: zod omits an absent optional `path`, so the spread
  changed key order between an omitted path and a spelled-out root, which
  main's fixed key order avoided. Accepted delta (T-01): a forgotten field
  now fails as `Invalid cursor`.
- **F3:** `readPendingVerdict` in `input-required.ts` returns
  `'accepted' | 'skipped' | { refused }`. `create`, `move` and `delete` keep
  their own outcome mapping.
- **F4:** `isEntryAccessible` is inlined into `list.ts`. `path.ts` drops
  the method and its two errno imports.

Chain (T-03): pin tests were written first and passed against the old
code. The F2 cursor identity test covers every non-paging arg of the three
tools, page-size changes, and an omitted vs spelled root; it fails without
the sort. The F3 test covers 16 outcome cases: create, move, copy and delete
against accept, skip, decline and cancel. Then `refactor`, `bug-hunt` (1
Minor, fixed) and `qc` (1 Minor, fixed); both verified adversarially.

Completion check: `npm run check` exit 0, 698 tests: 693 pass, 0 fail,
5 skipped (Windows). CI on the PR passed on ubuntu-latest and
windows-latest, plus CodeQL. Net line delta: `src/` +101 / -109 (-8); the
pin tests add +175.

Material uncertainty: none. Pre-existing and unchanged: on Windows, a root
spelled with a different drive-letter case than the guard stores keys
differently. Main's hand-built keys did the same.

Redraw: T-06 unaffected; B3 branches from `cd242a8c`. B3 now also touches
`list.ts`, which holds the inlined filter, and `cursor.ts` sits beside the
files B3 moves; no conflict. T-07 unaffected.
