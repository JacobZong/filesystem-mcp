---
kind: frontier-ticket
id: T-01
title: How should the 9 audit findings be batched into PRs?
map: M-01
status: closed
type: grilling
mode: hitl
priority: 10
blocked_by: []
claimed: 2026-10-12T00:00:00Z
---

## Question

How should the 9 findings from
[audit findings](../../assets/audit-findings.md) be batched into PRs? The
shared-file overlaps the map's Notes name are the constraint: `resources.ts`
(findings 4 and 5), `stdio.test.ts` (findings 2 and 3), and the
`helpers.ts`/`input-required.test.ts`/`cli.test.ts` cluster (finding 3).
The 2026-10-02 map's precedent was one PR per shared production file, with
test-file overlaps rebased between merges.

Priority 10: the batch composition gates the delivery process (T-02), the
merge order (T-04), and every per-batch delivery ticket.

## Resolution

Confirmed with the user: **four PRs**, zone-folded. The shared-file pairs
stay together and the disjoint singletons fold by zone, halving the
precedent's merge count while keeping every revert unit meaningful:

- **resources.ts batch** — findings 4 and 5 (contracts delegation, notify
  `voidSend` helper).
- **test-cluster batch** — findings 2 and 3 (dissolve
  `high-severity-fixes.test.ts`, `modernClientMeta` in helpers).
- **core singles batch** — findings 1, 6 and 9 (`store.ts` cap import,
  `search.ts` generator inline, `readLeadingSample` param drop).
- **tool singles batch** — findings 7 and 8 (`replace_text` TOO_LARGE
  owner call, `list.ts` shadow timer).

Findings 1 and 7 carry the two visible behaviour changes, so the core and
tool singles batches wait on the acceptance ticket (T-03) as well as the
process (T-02) and merge order (T-04) tickets.

Material uncertainty: none.