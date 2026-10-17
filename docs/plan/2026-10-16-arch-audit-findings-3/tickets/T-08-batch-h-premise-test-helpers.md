---
kind: frontier-ticket
id: T-08
title: Batch H premise - 19 recompute pairs and 2 SSE parses, live?
map: M-01
status: closed
type: research
mode: afk
priority: 100
blocked_by: []
claimed:
---

## Question

Do finding 6 and finding 12 of [the audit asset](../assets/audit-findings.md)
hold live: 19 hand-typed PathGuard recompute pairs, and the SSE response parse
copied in two test files? Unblocks [batch H delivery](T-15-deliver-batch-h-test-helpers.md).

## Research context

- Unblocks: batch H delivery (T-15) — `makeRecomputedGuard(dirs)` in
  `__tests__/helpers.ts`; `responseJson` in helpers.
- Starting sources: `__tests__/helpers.ts:157-162` (`makeGuard`, env-free
  variant); `__tests__/guards.test.ts` and `__tests__/path-guard-grant.test.ts`
  (the pairs; audit counts 19); `__tests__/cli.test.ts:170-176` and
  `__tests__/input-required.test.ts:585` (`callHttp`) + `:608-614` (SSE parse).
- Scope and evidence: count the recompute pairs exactly and list them; confirm
  `makeGuard` covers only the env-free variant and why (the production path
  reads `FS_ALLOWED_DIRS` at recompute — `src/core/path.ts:1175` audit cite);
  confirm the two SSE parses are verbatim-identical and that `callHttp`
  already half-owns one. Check both refuted lists for collisions (the refuted
  `createTestServer`/`withBoundary` and `bootHttpTest` items are different
  helpers). Cite `file:line` and counts. A shifted count that breaks the
  helper shape is a failed return.

## Resolution

LIVE with a count shift: 16 strict pairs (guards.test.ts `:179-180`,
`:214-215`, `:232-233`; path-guard-grant.test.ts `:64-65`, `:88-89`,
`:127-128`, `:157-158`, `:174-175`, `:193-194`, `:220-221`, `:239-240`,
`:264-265`, `:279-280`, `:295-296`, `:312-313`, `:331-332`) — 18 awaited
recompute calls in the two files; 19 only if counting `helpers.ts:234`.
Shape intact: `makeRecomputedGuard(dirs)` is a drop-in for all 16; the 2
re-recomputes (`guards.test.ts:188`, `path-guard-grant.test.ts:162`) and
`helpers.ts:234` stay hand-written. `makeGuard` covers only the env-free
path because recompute reads `FS_*` at call time (`path.ts:1175-1187`).
Finding 12: SSE parse verbatim x2 (`cli.test.ts:170-177`,
`input-required.test.ts:608-615`); the half-owner is `post`
(`input-required.test.ts:584-616`), not `callHttp` (no such name exists).
Correction: `createTestServer`/`withBoundary`/`bootHttpTest` do not appear in
either refuted list. No collision.

Material uncertainty: whether the audit's 19 matched `35c0daa0` exactly — a
harmless count shift; the helper shape is unaffected.
