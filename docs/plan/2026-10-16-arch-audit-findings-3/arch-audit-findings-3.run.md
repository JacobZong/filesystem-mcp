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

## Batch C — [T-10, sensitive-dir prune in the shared walk](tickets/T-10-deliver-batch-c-sensitive-walk.md)

- **C1** 2026-10-16 — done. Drift check: only batch A's list.ts stat swap; the
  ancestor loop and all premise files unchanged.
- **C2** 2026-10-16 — done. Seam implemented per T-03: `GlobEntriesOptions.pathGuard`
  (opt-in), `sensitiveDir` test in `prune` + `isExcluded`, ancestor loop deleted
  from list, searchContent/searchFiles/replace-text pass it, move does not.
- **C3** 2026-10-16 — done. Red-then-green: pin extended (token file under
  `vault.key`, tightened asserts); implementation stashed → test fails; restored
  → passes (44/0). CHANGELOG Unreleased Security entry.
- **C4** 2026-10-16 — done. `npm run check` → exit 0.

### Done

- [x] Execution contract: `npm run check` → exit 0.
- [x] Contract snapshot untouched (no surface change).
- [x] PR: https://github.com/j0hanz/filesystem-mcp/pull/108

## Batch D — [T-11, base64EncodedBytes owner and sha256Hex helper](tickets/T-11-deliver-batch-d-base64-sha256.md)

- **D1** 2026-10-16 — done. Drift check: zero on all four files; T-04 cites
  exact.
- **D2** 2026-10-16 — done. `base64EncodedBytes` added to `core/util.ts` beside
  `jsonByteBound`; three sites routed. `sha256Hex` local to `read.ts`; three
  sites routed. No behavior change; wire-limit prose untouched per the record.
- **D3** 2026-10-16 — done. `npm run check` → exit 0.

## Batch C follow-up — [T-19, sensitive ancestors in the walk filter](tickets/T-19-deliver-108-followup-sensitive-ancestors.md)

- **F1** 2026-10-16 — done. Both #108 review findings (Codex P1, Copilot High)
  verified by engine probe on merged main: literal sensitive prefixes yield
  through the guard; a denylisted symlink is followed and matched.
- **F2** 2026-10-16 — done. Red: literal-prefix pins (find_files, search_text)
  and a sensitive-named symlink subtree test fail on main.
- **F3** 2026-10-16 — done. Green: cached `sensitiveTree` ancestor check in
  `prune` + `isExcluded`; both pins pass; probe re-run clean. `npm run check`
  → exit 0. CHANGELOG Security bullet extended. Probe scripts:
  `C:\tmp\fsmp-probe\probe2.mjs`, fixture `C:\tmp\fsmp-fixture2`.

### Done

- [x] Execution contract: `npm run check` → exit 0.
- [x] Contract snapshot untouched (no surface change).
- [x] PR: https://github.com/j0hanz/filesystem-mcp/pull/109
- [x] PR: https://github.com/j0hanz/filesystem-mcp/pull/110 (no merge until
      the user rules on it, per the 2026-10-16 standing order)
