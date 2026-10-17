---
kind: frontier-ticket
id: T-16
title: Deliver batch F - one Unicode fold primitive (finding 7)
map: M-01
status: open
type: task
mode: afk
priority: 100
blocked_by: []
claimed:
---

## Question

Deliver finding 7 per [the audit asset](../assets/audit-findings.md), scope
re-cut by [the batch F premise](T-06-batch-f-premise-fold-predicate.md):
add `foldUnicodeSpelling(name)` to `src/core/path-utils.ts` (NFC +
`\p{Zs}`-space fold only), and express `unicodeMatchKey` (`path-utils.ts:203`,
keeping its platform case fold via `normalizeCaseForComparison`) and
`sensitive.ts`'s `foldForMatch` (`:33-36`, keeping its always-lowercase mode)
through it. Finding 8's predicate is out — ADR-002:108-110 blesses the double
spelling; do not touch `server.ts:95` or `resources.ts:536`. No behavior
change. Drift check first (`git diff 35c0daa0..HEAD -- src/core/path-utils.ts
src/core/sensitive.ts`); a premise mismatch is a STOP. Own PR; contract
completion check; resolution links the PR.
