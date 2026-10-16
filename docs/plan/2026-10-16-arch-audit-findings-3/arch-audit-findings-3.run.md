# Run: seventh audit delivery map

Executing the execution contract in
[arch-audit-findings-3.map.md](arch-audit-findings-3.map.md), started
2026-10-16 at `35c0daa0`.

## Batch A — [T-01, guarded list stat](tickets/T-01-deliver-batch-a-guarded-list-stat.md)

- **A1** 2026-10-16 — done. Drift check
  `git diff 35c0daa0..HEAD -- src/tools/list.ts docs/plan/2026-10-15-list-sizes/`
  → empty (HEAD == the audit commit).
- **A2** 2026-10-16 — done. Swap applied: the sizes stat now goes through the
  guarded filesystem. One deviation from the plan record's literal shape:
  collect's options carried only `pathGuard`, so `ctx.fs` was threaded in as a
  new options field — the plan's excerpt assumed it already existed. Raw
  `node:fs/promises` stat import and `withAbort` wrapper removed.
- **A3** 2026-10-16 — done. `npm run check` → exit 0 (static + full suite +
  coverage floor).
- **A4** 2026-10-16 — done. Review pass (bug-hunt axis) verdict: net security
  tightening, one yellow — abort no longer raced the first await, because the
  guarded stat validates before statting and that validation is not
  abort-aware. Fix: `options.signal.throwIfAborted()` at the top of the try.
  `npm run check` re-run → exit 0.

### Done

- [x] Execution contract: `npm run check` → exit 0.
- [x] Contract snapshot untouched (no surface change).
- [x] PR: https://github.com/j0hanz/filesystem-mcp/pull/106
