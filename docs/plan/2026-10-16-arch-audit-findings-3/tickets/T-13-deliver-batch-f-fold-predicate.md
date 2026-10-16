---
kind: frontier-ticket
id: T-13
title: Deliver batch F - one Unicode fold primitive and one legacyHttp predicate (findings 7+8)
map: M-01
status: closed
type: task
mode: afk
priority: 100
blocked_by: [T-06]
claimed:
---

## Question

Deliver findings 7 and 8 per [the audit asset](../assets/audit-findings.md),
only after [their premise](T-06-batch-f-premise-fold-predicate.md) resolved
live and named the fold primitive's home and signature: share the NFC +
`\p{Zs}` fold between `path-utils.ts` and `sensitive.ts` (each keeps its case
mode), and compute the stateless-legacy-HTTP predicate once in `createServer`,
threading it through the deps both registrars already receive. No behavior
change. Drift check first (`git diff 35c0daa0..HEAD -- src/core/path-utils.ts
src/core/sensitive.ts src/server.ts src/resources.ts src/tools/define.ts`);
a premise mismatch is a STOP. Own PR; contract completion check; resolution
links the PR.

## Resolution

Superseded. [Batch F premise](T-06-batch-f-premise-fold-predicate.md)
record-refuted the predicate half — ADR-002:108-110 blesses the predicate
spelled twice — so this ticket's two-finding scope is invalid. Replaced by
[Deliver batch F - one Unicode fold primitive (finding 7)](T-16-deliver-batch-f-fold-primitive.md).
