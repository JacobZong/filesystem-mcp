---
kind: frontier-ticket
id: T-11
title: Deliver batch D - base64EncodedBytes owner and sha256Hex helper (findings 4+11)
map: M-01
status: open
type: task
mode: afk
priority: 100
blocked_by: [T-04]
claimed:
---

## Question

Deliver findings 4 and 11 per [the audit asset](../assets/audit-findings.md),
only after [their premise](T-04-batch-d-premise-base64-sha256.md) resolved
live: add `base64EncodedBytes(size)` to `core/util.ts` beside `jsonByteBound`
and route the three sites through it; add a local `sha256Hex` in
`tools/read.ts` and route its three sites through it. No behavior change;
wire-limit PROSE stays where it is (refuted-list pin). Drift check first
(`git diff 35c0daa0..HEAD -- src/core/file-uri.ts src/resources.ts
src/tools/read.ts src/core/util.ts`); a premise mismatch is a STOP. Own PR;
contract completion check; resolution links the PR.
