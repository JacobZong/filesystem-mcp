---
kind: frontier-ticket
id: T-11
title: Deliver the singles batch (findings 2, 6, 13)
map: M-01
status: in-progress
type: task
mode: afk
priority: 10
blocked_by: ["T-06", "T-07"]
claimed: 2026-10-13T17:00:00Z
---

## Question

Deliver findings 2, 6 and 13 from [audit findings](../assets/audit-findings.md)
in one PR touching `src/tools/define.ts`, `src/tools/index.ts`,
`src/core/errors.ts` and `docs/adr/002-legacy-protocol-paths-sunset.md`.

13 lands as an "Amended 2026-10-13" line
([Are the visible behavior changes acceptable?](T-04-behaviour-acceptance.md)).

Follow the process T-07 settles and the merge slot T-06 settles.
Completion follows the map's execution contract.

Priority 10: merge slot 1 of 7 (T-06).
