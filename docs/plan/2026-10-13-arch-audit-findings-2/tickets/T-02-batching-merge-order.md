---
kind: frontier-ticket
id: T-02
title: How do the 11 findings batch into PRs, and in what order do they merge?
map: M-01
status: closed
type: grilling
mode: hitl
priority: 20
blocked_by: []
claimed:
---

## Question

How do the 11 findings group into file-disjoint PRs, and in what order does
the chain merge? Overlap web (from [audit findings](../assets/audit-findings.md)):

- F6 (primitives homes) touches `list.ts`, `find-files.ts`, `search-text.ts`,
  `replace-text.ts`, `path.ts`, `path-utils.ts`, `sensitive.ts`, `util.ts`,
  `cli.ts`, `http.ts` — crossing F1 (`search-text.ts`, `move.ts`), F2
  (`list.ts`, `find-files.ts`, `search-text.ts`, `cursor.ts`) and F4
  (`path.ts`, `list.ts`).
- F3 (`create.ts`, `move.ts`, `delete.ts`, `input-required.ts`) crosses F1 on
  `move.ts`.
- F9 (`server.ts`, `tools/index.ts`, `prompts.ts`, `resources.ts`) crosses F8
  (`resources.ts`, ADR-003) on `resources.ts`.
- F10 (ADR-001/002/003, `sensitive.ts`, `http-policy.ts`) crosses F6 on
  `sensitive.ts`.
- Disjoint: F5 (`read.ts`), F7 (tests), F11 (tests).

Precedent: the fifth audit's map used four file-disjoint batches in one
merge chain. Shared-file conflicts must be named, not discovered at
rebase time.

## Resolution

Decided 2026-10-13 (user, live): **four batches, one sequential merge chain.**
Each batch merges to `main` before the next branches from it.

| Batch | Findings | Files (at `4153e7e0`) | Shared-file conflict |
| :-- | :-- | :-- | :-- |
| B1 isolated | F5, F7, F11 | `read.ts`; tests + `__tests__/helpers.ts` | none |
| B2 tools | F1, F2, F3, F4 | `search-text.ts`, `move.ts`, `list.ts`, `find-files.ts`, `cursor.ts`, `create.ts`, `delete.ts`, `input-required.ts`, `path.ts` | internal only (`move.ts` F1/F3, `list.ts` F2/F4, `search-text.ts` F1/F2) |
| B3 primitives | F6 + F10's `sensitive.ts:214` anchor | `path-utils.ts`, `sensitive.ts`, `util.ts`, `path.ts`, `cli.ts`, `http.ts`, list/find-files/search-text/replace-text | branches after B2: import lines in list/find-files/search-text/`path.ts` |
| B4 records | F8, F9, F10 remainder | `resources.ts`, `server.ts`, `tools/index.ts`, `prompts.ts`, `http-policy.ts`, ADR-001/002/003 | ADR anchors cite `move.ts` (B2), `http.ts` (B3), `resources.ts` (B4 itself) — re-read after B2, B3 land |

Evidence: the overlap web forms one connected component (F1–F4, F6, F8–F10
via `move.ts`, `list.ts`, `search-text.ts`, `path.ts`, `sensitive.ts`,
`resources.ts`, ADR-003); only F5, F7, F11 are disjoint, so fully
file-disjoint batches are impossible without one giant PR. Folding F10's
`sensitive.ts` anchor into B3 removes the only B3/B4 shared source file.
ADR-001 cites `move.ts#L443` (B2 edits `move.ts`), hence B4 last.

Also decided: **F10 anchors swap to grep-able symbol names where a symbol
exists** (plans/039 recipe); line links stay only where no symbol exists.

Material uncertainty: none.

Redraw: fog "per-batch delivery task tickets" graduates — membership is now
fixed, so each batch is statable as a task ticket (T-04..T-07), blocked by
T-03 (chain) and by its predecessor batch. T-03 updated to name B1–B4.
