---
kind: frontier-ticket
id: T-08
title: Deliver the tool singles batch (findings 7 and 8)
map: M-01
status: closed
type: task
mode: afk
priority: 30
blocked_by: ["T-02", "T-03", "T-04"]
claimed:
---

## Question

Deliver the tool singles batch from
[audit findings](../../assets/audit-findings.md): findings 7
(`replace-text.ts` calls `createTooLargeError(stats.size, maxFileSize,
validPath)` instead of the hand-rolled message) and 8 (`list.ts` passes
`signal: ctx.signal` instead of the shadowed second deadline timer).
`replace-text.ts` and `list.ts` are disjoint files, so both moves land in
one PR. Finding 7 is one of the two visible behaviour changes T-03
accepts. The delivery follows the process T-02 settles for this batch, the
PR merges in the order T-04 settles, and completion follows the map's
execution contract.

Priority 30: first in the risk-ascending merge chain T-04 settled.
## Resolution

Delivered via
[PR #63](https://github.com/j0hanz/filesystem-mcp/pull/63), merged to
`main` as `b1d96f99` on 2026-10-12 (commits `14f381a1` and the test pin
`103be4e6`). Closed on 2026-10-13 during load-time recovery; the claim
had been left open after the merge.

- Completion check:
  - Finding 7: `src/tools/replace-text.ts:333` throws
    `createTooLargeError(stats.size, maxFileSize, validPath)`.
  - Finding 8: `src/tools/list.ts` no longer contains `AbortSignal.any`.
  - The PR's CI was green (3 checks).
- Not recorded at merge time: the local `npm run check` counts and the
  net line delta. PR #63 itself carries them.
