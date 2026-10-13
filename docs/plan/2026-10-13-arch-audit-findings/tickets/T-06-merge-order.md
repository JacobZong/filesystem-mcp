---
kind: frontier-ticket
id: T-06
title: In what order do the batches merge relative to M-01?
map: M-01
status: open
type: grilling
priority: 100
blocked_by: ["T-05"]
claimed:
---

## Question

In what order do this map's batch PRs merge, interleaved with the open
2026-10-12 map's remaining batches (core singles, resources.ts, test
cluster), so that shared files need the fewest rebases? The finding 1
security PR merges first of all (T-03).
