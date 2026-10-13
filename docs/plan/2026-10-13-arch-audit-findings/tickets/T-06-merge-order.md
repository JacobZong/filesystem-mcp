---
kind: frontier-ticket
id: T-06
title: In what order do the batches merge relative to M-01?
map: M-01
status: closed
type: grilling
priority: 100
blocked_by: ["T-05"]
claimed:
---

## Question

In what order do this map's four batch PRs merge, interleaved with the
2026-10-12 map's remaining batches, so that shared files need the fewest
rebases?

- This map's batches: singles {2, 6, 13}, tool code {3, 7, 8, 9, 14},
  guard {4, 12, 15}, transport {5, 10, 11}. They share no files.
- The 2026-10-12 map's open batches: core singles (its findings 1 and 6;
  its finding 9 shipped in PR #72), resources.ts (its findings 4 and 5)
  and the test cluster (its findings 2 and 3).
- Known overlap: the transport batch and that map's resources.ts batch
  both touch `server.ts` and `stdio.ts`.

## Resolution

Confirmed with the user, 2026-10-13: one chain across both maps, fixed
up front and ordered by rising risk.

1. Singles (this map: 2, 6, 13). Pure refactors plus the ADR line.
2. Core singles (2026-10-12 map: 1, 6).
3. Tool code (this map: 3, 7, 8, 9, 14).
4. Guard (this map: 4, 12, 15).
5. resources.ts (2026-10-12 map: 4, 5). Adds `voidSend` in `server.ts`
   and `stdio.ts`.
6. Transport (this map: 5, 10, 11). Rebases once onto slot 5's
   `server.ts` and `stdio.ts`.
7. Test cluster (2026-10-12 map: 2, 3). Last, per the 2026-10-02 and
   2026-10-12 precedent.

Each slot merges only after the previous one is on `main`. Apart from the
slot 5 and 6 pair, the only overlap between batches is CHANGELOG
`[Unreleased]` text.

Material uncertainty: the 2026-10-12 map's slots (2, 5, 7) are delivered
by that map's own tickets. This map cannot block on them, so its tickets
carry the dependency as text.
