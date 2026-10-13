---
kind: frontier-ticket
id: T-05
title: How are the 15 findings batched into PRs alongside M-01?
map: M-01
status: closed
type: grilling
priority: 100
blocked_by: ["T-03"]
claimed:
---

## Question

How do findings 2-15 group into PRs? Finding 1 is settled as its own
first PR by
[Does finding 1 ship as a security fix, separately and first?](T-03-security-fix-first.md).

Shared files inside this map:

- `edit.ts`: findings 3, 8, 9
- `search-text.ts`: findings 7, 8
- `replace-text.ts`: findings 8, 14
- `path.ts`: findings 4, 12, 15
- `server.ts` and `stdio.ts`: findings 10, 11

Shared with the open 2026-10-12 map: its finding 5 (`server.ts`,
`stdio.ts`). Does any finding fold into a sibling-map batch instead?

## Resolution

Confirmed with the user, 2026-10-13: four PRs, split by shared file and
disjoint from one another.

| Batch | Findings | Files |
| :--- | :--- | :--- |
| Singles | 2, 6, 13 | `tools/define.ts`, `tools/index.ts`, `core/errors.ts`, `docs/adr/002-…` |
| Tool code | 3, 7, 8, 9, 14 | `tools/edit.ts`, `patch.ts`, `create.ts`, `replace-text.ts`, `search-text.ts`, `list.ts`, `find-files.ts`, `core/schema.ts` |
| Guard | 4, 12, 15 | `core/path.ts`, `core/path-completer.ts` |
| Transport | 5, 10, 11 | `index.ts`, `cli.ts`, `server.ts`, `transport/shared.ts`, `transport/stdio.ts`, `transport/http.ts` |

The 2026-10-12 map's finding 5 (the `voidSend` failed-notify helper) is
not folded in. It stays in that map's resources.ts batch, which overlaps
the transport batch on `server.ts` and `stdio.ts`. The merge-order
ticket sequences that rebase.
