---
kind: frontier-ticket
id: T-12
title: Deliver the tool-code batch (findings 3, 7, 8, 9, 14)
map: M-01
status: closed
type: task
mode: afk
priority: 30
blocked_by: ["T-06", "T-07"]
claimed:
---

## Question

Deliver findings 3, 7, 8, 9 and 14 from
[audit findings](../assets/audit-findings.md) in one PR touching
`src/tools/edit.ts`, `patch.ts`, `create.ts`, `replace-text.ts`,
`search-text.ts`, `list.ts`, `find-files.ts` and `src/core/schema.ts`.

Settled by
[Are the visible behavior changes acceptable?](T-04-behaviour-acceptance.md):

- 3: the undefined `resourceUri` key stays.
- 8: edit takes the shared "cannot be empty or whitespace-only" wording,
  and `nonBlankString(label)` takes no message option.

Follow the process T-07 settles and the merge slot T-06 settles.
Completion follows the map's execution contract.

Priority 30: merge slot 3 of 7 (T-06), after the 2026-10-12 map's core singles batch merges.

## Resolution

Delivered, 2026-10-13, via
[PR #75](https://github.com/j0hanz/filesystem-mcp/pull/75), merged to
`main` as `f8653ec5` with the user's go-ahead (merge slot 3 of 7).

- Completion check (the execution contract):
  - Findings 3, 7, 8, 9 and 14 are in the diff, as the ticket states.
  - `npm run check` exits 0: 673 tests, 668 pass, 5 skipped.
  - The contract snapshot is unchanged.
  - CI is green on all 6 checks.
- `src/` net line delta: +242 / -353 (-111) across 8 files.
- Process (T-07, direct): a pin test for finding 8, written first and
  failing on `main` (old wording, plus a doubled message for empty
  input), then refactor, then one combined bug-hunt and qc review
  (approved, nothing blocking).
- Scope note: the empty `searchPattern` in search_text and replace_text
  also takes the shared wording, because one schema now serves all three
  fields. T-04 settled that wording for edit.
