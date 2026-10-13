---
kind: frontier-ticket
id: T-04
title: Deliver batch B1: F5, F7, F11
map: M-01
status: closed
type: task
mode: hitl
priority: 100
blocked_by: [T-03]
claimed:
---

## Question

Batch B1 (isolated, no shared-file conflicts): F5 oversize refusal through `createTooLargeError` with per-site remedies forwarded as `suggestion` (T-01); F7 out-of-root fixture sites onto `createTestRoot`/`cleanupTestRoot`; F11 `MODERN_PROTOCOL_REVISION` re-exported from `__tests__/helpers.ts` at the three literal sites.

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
[#81](https://github.com/j0hanz/filesystem-mcp/pull/81), merged as
`f4124ef2` on the user's confirmation.

- **F5:** `createTooLargeError` takes optional `{ label, suggestion }`. The
  three `read.ts` sites route through it, each forwarding its own remedy as
  the `suggestion` (T-01). `assertSizeWithinLimit` is inlined away. Pin tests
  in `__tests__/core-fs.test.ts` ("Oversize read refusal") were written
  first, failed against the old wording, and pass after.
- **F7:** the five mkdtemp-dir sites and the two tmpdir-file sites use
  `createTestRoot`/`cleanupTestRoot`. The `path-guard-grant` `mkDir` helper
  drops its prefix parameter.
- **F11:** the three literals use `MODERN_PROTOCOL_REVISION`. Deviation from
  the asset: the tests import it directly from `src/core/config.ts`, as
  `cli.test.ts` does, not through a `helpers.ts` re-export. The `qc` pass
  flagged the re-export as a second import path for one constant. The
  finding's point, one owner for the value, holds either way.

Chain (T-03): pin, then refactor, then `bug-hunt` (0 findings) and `qc`
(2 Minor, both verified and fixed).

Completion check: `npm run check` exit 0, 681 tests: 676 pass, 0 fail,
5 skipped (Windows). CI on the PR passed on ubuntu-latest and
windows-latest, plus CodeQL. Net line delta: code and tests +92 / -55
(+37; `src/core/read.ts` -3; the pin tests add +40).

Material uncertainty: none new. One unverified edge is recorded in the PR's
review focus: a per-path failure row that prints only the message would drop
the remedy. T-01 already accepted that a message-only client sees less.

Redraw: T-05..T-07 unaffected. B2 branches from `f4124ef2`.
