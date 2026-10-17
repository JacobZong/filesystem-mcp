Status: clean

# Plan hunt: Each core primitive has one home, and the denylist's records name it

Hunted [`b3-primitives.plan.md`](b3-primitives.plan.md) at `cd242a8c`, 2026-10-13.

## Confirmed

none

## Suspected

none

## Coverage

- Drift check: ran; empty diff, exit 0.
- Current state: every excerpt re-opened at its `file:line` and matched —
  `path-utils.ts:1-2,4,44-57,59-65,80,108-113,151`; `sensitive.ts:1-13,208-236,311`;
  `util.ts:1-4,45-56`; `path.ts:4,18-31,35,102-105,741,755`; `cli.ts:11-17,20`;
  `http.ts:25,29`; tool imports `list.ts:9-11`, `find-files.ts:5`,
  `search-text.ts:8`, `replace-text.ts:16`.
- Step 1: `CHAR_COLON` has one use in `sensitive.ts` (`:222`); both trims are
  `/[. ]+$/` on one segment (byte-identical). Verify grep run once against the
  current tree (4 lines today; 2 expected after the step).
- Step 2: cycle check — `path-utils.ts` imports only `node:os`/`node:path`;
  `config.ts` has no imports; `util.ts` imports `config.ts` and
  `path-utils.ts`; `sensitive.ts`, `path.ts`, `cli.ts`, `http.ts` already import
  `util.ts`. No test or script imports or mocks a moved symbol.
- Step 3: `relative` in `path.ts` is used only at `:104` (other hits are prose);
  `toPosixPath` there only at `:104` plus the `:35` comment.
- Step 4, Step 5, Done, STOP: commands run once; all resolve. STOP names
  change-specific risks (cycle, trim identity, test-outcome change).
- No candidate survived the hunter's own checks, so no refuter dispatch was
  needed.
