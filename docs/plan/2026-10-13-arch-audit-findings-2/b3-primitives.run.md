# Run: Each core primitive has one home, and the denylist's records name it

Executing [`b3-primitives.plan.md`](b3-primitives.plan.md), started 2026-10-13 at `cd242a8c`.

- **0** 2026-10-13 — drift check empty; Current state matched (plan-hunt re-opened every excerpt at `cd242a8c`).
- **1** 2026-10-13 — done. `npx tsc --noEmit -p tsconfig.json` → exit 0; duplicate probe → 2 lines, both `src/core/path-utils.ts`. Deviation: the inline comment sat at 4-space indent, not the plan's implied 6; the first scripted edit missed it and was rerun.
- **2** 2026-10-13 — done. `npx tsc --noEmit -p tsconfig.json` → exit 0; `grep -rn "parseTrueEnvFlag" src | grep "path-utils"` → no output.
- **3** 2026-10-13 — done. `npx tsc --noEmit -p tsconfig.json` → exit 0; `grep -rn "toPosixRelative" src | grep "core/path.ts"` → no output. Deviation: first scripted edit missed `path-utils.ts` on backslash escaping (`path.ts` had applied); rerun completed it.
- **4** 2026-10-13 — done. `grep -n "shares only" src/core/sensitive.ts` → `4:// shares only character-level primitives from path-utils.ts, not the` (header comment reflowed).
- **5** 2026-10-13 — done. `npm run check` → exit 0; 698 tests, 693 pass, 0 fail, 5 skipped; knip clean.

## Done

- [x] `npm run check` exits 0 → exit 0 (build, test typecheck, lint, prettier, knip, tests).
- [x] `grep -rn "CHAR_COLON = 58" src` → `src/core/path-utils.ts:80:export const CHAR_COLON = 58;`
- [x] `grep -rn "parseTrueEnvFlag(value" src` → `src/core/util.ts:63:export function parseTrueEnvFlag(value: `
- [x] `grep -rn "export function toPosixRelative" src` → `src/core/path-utils.ts:74:export function toPosixRelative(fr`
- [x] `grep -n "(path.ts)" src/core/sensitive.ts` → no output (exit 1).
- [x] `git status --short` → in-scope files only, plus this effort's `docs/plan/` records:
  - ` M docs/plan/2026-10-13-arch-audit-findings-2/arch-audit-findings-2.map.md`
  - ` M docs/plan/2026-10-13-arch-audit-findings-2/tickets/T-05-deliver-b2-tools.md`
  - ` M docs/plan/2026-10-13-arch-audit-findings-2/tickets/T-06-deliver-b3-primitives.md`
  - ` M src/cli.ts`
  - ` M src/core/path-utils.ts`
  - ` M src/core/path.ts`
  - ` M src/core/sensitive.ts`
  - ` M src/core/util.ts`
  - ` M src/tools/find-files.ts`
  - ` M src/tools/list.ts`
  - ` M src/tools/replace-text.ts`
  - ` M src/tools/search-text.ts`
  - ` M src/transport/http.ts`
  - `?? docs/plan/2026-10-13-arch-audit-findings-2/b3-primitives.plan-hunt.md`
  - `?? docs/plan/2026-10-13-arch-audit-findings-2/b3-primitives.plan.md`
  - `?? docs/plan/2026-10-13-arch-audit-findings-2/b3-primitives.run.md`

## Review

- `bug-hunt` (cycles, module-load order, Windows denylist trim semantics, public surface) → 0 findings.
- `qc` (homes per plan, stale comments or docs naming old locations) → 0 findings.
