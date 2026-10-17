---
kind: frontier-ticket
id: T-15
title: Deliver batch H - makeRecomputedGuard and responseJson in test helpers (findings 6+12)
map: M-01
status: open
type: task
mode: afk
priority: 100
blocked_by: [T-08]
claimed:
---

## Question

Deliver findings 6 and 12 per [the audit asset](../assets/audit-findings.md),
only after [their premise](T-08-batch-h-premise-test-helpers.md) resolved
live: add `makeRecomputedGuard(dirs)` to `__tests__/helpers.ts` and collapse
the 19 hand-typed recompute pairs; add `responseJson` to helpers and collapse
the two SSE parse copies. Tests only; no src change. Drift check first
(`git diff 35c0daa0..HEAD -- __tests__/helpers.ts __tests__/guards.test.ts
__tests__/path-guard-grant.test.ts __tests__/cli.test.ts
__tests__/input-required.test.ts`); a premise mismatch is a STOP. Own PR;
contract completion check; resolution links the PR and the pair count collapsed.


Amendment 2026-10-16, from [the premise resolution](T-08-batch-h-premise-test-helpers.md):
exact targets are 16 strict pairs (guards.test.ts 3, path-guard-grant.test.ts
13; list in the resolution) — the 2 re-recomputes and `helpers.ts:234` stay
hand-written. The SSE half-owner is `post` in `input-required.test.ts:584-616`,
not `callHttp`.
