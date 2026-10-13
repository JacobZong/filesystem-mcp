# Run: Route every read through `GuardedFileSystem` so no read path skips the H4 re-check

Executing [`read-path-h4.plan.md`](read-path-h4.plan.md), started 2026-10-13 at `1bc6b791`. Drift check: no files changed.

- **1** 2026-10-13: done. `git branch --show-current` → `fix/read-path-h4-bypass`.
- **2** 2026-10-13: done. Targeted tests → `tests 63, pass 60, skipped 3, fail 0`. Deviation: the first write put literal newlines in two string literals (an escaping slip in my scripted edit); fixed, and `type-check:test` exits 0.
- **3** 2026-10-13: done. `npm run build` and `npm run type-check:test` exit 0. `grep -rn readFileWithStats src` gives 4 lines, none in `src/tools`. `countFileLines` exists only as the method plus `ctx.fs.countFileLines` in `create.ts`. Targeted tests: `tests 63, fail 0`. Deviation: Python text mode on Windows wrote CRLF line endings into the edited files; stripped back to LF (a node check confirms 0 CR characters).
- **4** 2026-10-13: done. Build exits 0; `grep node:fs src/core/search.ts` gives no output. Targeted tests: `tests 63, fail 0`. Search and tools tests: `tests 139, pass 138, skipped 1, fail 0`.
- **5** 2026-10-13: done. `type-check:test` exits 0. Targeted tests: `tests 63, pass 60, skipped 3, fail 0`.
- **6** 2026-10-13: done. `npx prettier --check CHANGELOG.md` reports all matched files formatted.
- **7** 2026-10-13: done. `prettier --write` changed no files. `npm run check` exits 0: `tests 672, pass 667, skipped 5, fail 0`.
- **8** 2026-10-13: handed back. Commit, push and the Linux CI gate wait on the user's go-ahead. `src/` net line delta: +58 / -74 (-16).

## Done

- [x] `npm run check` exits 0 (672 tests, 667 pass, 5 skipped, 0 fail).
- [x] Targeted tests: `tests 63, fail 0`, including the ancestor-swap test (skipped on this Windows host).
- [x] `grep -rn "readFileWithStats" src/tools` gives no output.
- [x] `grep -n "verifyHandle?" src/core/read.ts` gives no output.
- [x] `grep -n "node:fs" src/core/search.ts` gives no output.
- [x] `grep -rn "readLeadingSample(.*," src` gives no output.
- [x] `git status --short` shows the 8 in-scope files plus `docs/plan/2026-10-13-arch-audit-findings/`.
- [ ] CI `Check (ubuntu-latest)` green on the PR. Pending the user's approval to push.

## After review

- 2026-10-13: bug-hunt confirmed one Minor (the CHANGELOG overclaimed on Windows). See [`read-path-h4.hunt.md`](read-path-h4.hunt.md).
- 2026-10-13: qc requested changes:
  - Finding 1: `readFile`'s `known` parameter trusted the caller's path.
  - Findings 2 and 3: unify the open path.
- 2026-10-13: user decision: fix qc finding 1 and the CHANGELOG in this PR; findings 2 and 3 become a follow-up.
  - Applied: dropped `known` from `GuardedFileSystem.readFile`, `BudgetItem` and `readOnePath`. The budget pass is now a size estimate only, and the batch read re-validates.
  - Applied: the CHANGELOG is scoped by platform.
  - `npm run check` exits 0: `tests 672, pass 667, skipped 5, fail 0`.
  - `src/` net line delta: +59 / -86 (-27).
  - The Done grep `readFileWithStats src/tools` still gives no output.
