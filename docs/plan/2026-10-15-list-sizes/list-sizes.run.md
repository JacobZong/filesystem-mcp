# Run: `list` gains opt-in sizes, sort-by-size, and a totals line (#99)

Executing [`list-sizes.plan.md`](list-sizes.plan.md), started 2026-10-15 at `8fffa76e`.

- **1** 2026-10-15: done. `npm test -- --test-name-pattern="#99"` → exit 1, `pass 44`, `fail 4` (the four red `(#99)` tests named; characterization pin test 3 passed).
- **2** 2026-10-15: done. `npm test -- --test-name-pattern="#99|TC-FUNC-063|TOOL-SURFACE"` → exit 0, `pass 54`, `fail 0`.
- **3** 2026-10-15: done. `npm test -- --test-name-pattern=CONTRACT` → exit 0, both CONTRACT-001 and CONTRACT-002 pass.
- **4** 2026-10-15: done. `npm run check` → exit 0 (after `prettier --write docs/client-guide.md`).

## Done

- [x] `npm run check` exits 0 (`check:static` + full test suite passed).
- [x] `npm test -- --test-name-pattern="#99"` shows 5 passing `#99` tests (`pass 48`, `fail 0`).
- [x] `git status --short` lists only `src/tools/list.ts`, `src/core/fmt.ts`, `__tests__/tools.test.ts`, `__tests__/contract.test.ts.snapshot`, `docs/client-guide.md`, and `docs/plan/2026-10-15-list-sizes/`.
