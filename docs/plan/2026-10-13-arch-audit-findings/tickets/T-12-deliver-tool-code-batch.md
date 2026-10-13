---
kind: frontier-ticket
id: T-12
title: Deliver the tool-code batch (findings 3, 7, 8, 9, 14)
map: M-01
status: in-progress
type: task
mode: afk
priority: 30
blocked_by: ["T-06", "T-07"]
claimed: 2026-10-13T19:00:00Z
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
