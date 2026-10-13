---
kind: frontier-ticket
id: T-05
title: How are the 15 findings batched into PRs alongside M-01?
map: M-01
status: open
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
