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
- **A5** 2026-10-16 — done. PR review round: Copilot's medium (same abort
  class, stronger fix) and Codex's P1 (no fd binding on the guarded stat)
  both ruled VALID against code. Copilot fix applied: the whole guarded stat
  is now wrapped in `withAbort`, replacing A4's boundary check.
  `npm run check` → exit 0. Codex residue charted as map tickets T-17/T-18
  (fd-bound `GuardedFileSystem.stat`, H4 class — needs a caller-inventory
  premise first, not silent scope growth in this PR).

### Done

- [x] Execution contract: `npm run check` → exit 0.
- [x] Contract snapshot untouched (no surface change).
- [x] PR: https://github.com/j0hanz/filesystem-mcp/pull/106

## Batch B — [T-09, derive the skippable errno set](tickets/T-09-deliver-batch-b-skippable-errno.md)

- **B1** 2026-10-16 — done. Drift check
  `git diff 35c0daa0..HEAD -- src/core/errors.ts src/tools/replace-text.ts src/core/path-completer.ts src/core/path.ts`
  → empty. T-02's flag resolved: the findings-2 inline-`isEntryAccessible` move
  never shipped (`list.ts` still calls `pathGuard.isEntryAccessible`), so the
  `path.ts:317` consumer is unchanged.
- **B2** 2026-10-16 — done. Red: flipped the `EPERM` characterization pin in
  `__tests__/errors.test.ts` (it asserted the divergence); targeted run fails on
  the flipped assert. Added an over-inclusion guard: `ENOTDIR` stays
  non-skippable.
- **B3** 2026-10-16 — done. Green: `SKIPPABLE_ERRNOS` now derived from
  `ERRNO_MAP x SKIPPABLE_FS_CODES`; targeted run passes.
- **B4** 2026-10-16 — done. `npm run check` → exit 0 (static + full suite +
  coverage floor). CHANGELOG Unreleased Fixed entry added.

### Done

- [x] Execution contract: `npm run check` → exit 0.
- [x] Contract snapshot untouched (no surface change).
- [x] PR: https://github.com/j0hanz/filesystem-mcp/pull/107
