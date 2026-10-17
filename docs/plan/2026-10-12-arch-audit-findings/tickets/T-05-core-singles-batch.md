---
kind: frontier-ticket
id: T-05
title: Deliver the core singles batch (findings 1, 6, 9)
map: M-01
status: closed
type: task
mode: afk
priority: 40
blocked_by: ["T-02", "T-03", "T-04"]
claimed:
---

## Question

Deliver the core singles batch from
[audit findings](../../assets/audit-findings.md): findings 1 (`store.ts`
imports `MAX_OUTBOUND_RESULT_BYTES`) and 6 (`search.ts` inlines
`guardedEntries`). `store.ts` and `search.ts` are disjoint files.

Finding 9 (`readLeadingSample` drops its `size` parameter) already
shipped in [PR #72](https://github.com/j0hanz/filesystem-mcp/pull/72),
folded into the 2026-10-13 map's security fix by that map's T-03. The
title still names it, because titles never change.

Finding 1 is one of the two visible behaviour changes T-03 accepts. The
delivery follows the process T-02 settles for this batch, and completion
follows the map's execution contract. In the cross-map chain the
2026-10-13 map's T-06 settled, this PR is merge slot 2 of 7, after that
map's singles batch (PR #73, merged).

Priority 40: second in the risk-ascending merge chain T-04 settled.

## Resolution

Delivered, 2026-10-13, via
[PR #74](https://github.com/j0hanz/filesystem-mcp/pull/74), merged to
`main` with the user's go-ahead (merge slot 2 of 7 in the cross-map
chain).

- Finding 6 delivered: `searchFiles` validates walked entries inline, and
  `guardedEntries` is deleted. qc traced every counter and close path and
  found no behaviour difference.
- Finding 1 refuted at delivery, not delivered:
  - Stdio's store already carries
    `{ maxReadResultBytes: MAX_OUTBOUND_RESULT_BYTES }`
    (`src/server.ts:178`).
  - So the move only swapped the refusal message on stdio, and it would
    have narrowed HTTP's cap.
  - The store change and its pin test were reverted. The refutation is
    recorded in [audit findings](../assets/audit-findings.md).
  - T-03's acceptance of finding 1's behaviour change is moot.
- Finding 9 shipped earlier in PR #72 (2026-10-13 map).
- Completion check:
  - `npm run check` exits 0: 672 tests, 667 pass, 5 skipped.
  - CI is green on all 6 checks.
  - `src/` net line delta: +28 / -38.
- Process (T-02, direct): test pin (for finding 1, later reverted), then
  refactor, then bug-hunt and qc in one review agent. qc's blocking
  items on finding 1 led to the revert. Its `filesScanned` cut was left
  out as beyond the contract scope, with the user's agreement.
