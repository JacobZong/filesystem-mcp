---
kind: frontier-ticket
id: T-04
title: Batch D premise - base64 formula x3 and sha256 chain x3, live?
map: M-01
status: closed
type: research
mode: afk
priority: 100
blocked_by: []
claimed:
---

## Question

Does finding 4 and finding 11 of [the audit asset](../assets/audit-findings.md)
hold live: the base64 formula `4 * Math.ceil(n / 3)` at three sites, and the
sha256 chain at three sites in `tools/read.ts`? Unblocks [batch D delivery](T-11-deliver-batch-d-base64-sha256.md).

## Research context

- Unblocks: batch D delivery (T-11) — `base64EncodedBytes(size)` in
  `core/util.ts` beside `jsonByteBound`; local `sha256Hex` in `read.ts`.
- Starting sources: `src/core/file-uri.ts:121`, `src/resources.ts:238`,
  `src/tools/read.ts:212` (formula); `src/tools/read.ts:275`, `:346`, `:377`
  (sha256); `src/core/util.ts` (`jsonByteBound` — the owner-neighbor
  precedent).
- Scope and evidence: confirm all six cites verbatim; grep for any fourth
  spelling of either pattern across `src/` (report counts); confirm the
  refuted lists pin only the wire-limit PROSE (cli-help/http/stdio restating)
  and not this arithmetic; confirm `util.ts` placement matches the
  `jsonByteBound` precedent. Cite `file:line` for every claim. A shifted cite
  is a failed return if the site no longer matches the audit's reading.

## Resolution

LIVE. All six cites verbatim at the audit's exact lines. No fourth spelling
(`4 * Math.ceil` 3 hits; alternative spellings 0 hits; `createHash(` 5 hits —
the 2 extras are `http-policy.ts:109-110`, a timing-safe compare with no hex
digest, a different concern). Neither `base64EncodedBytes` nor `sha256Hex`
exists yet. Refuted lists clear: the below-the-bar item pins wire-limit prose
only. `util.ts` placement matches the `jsonByteBound` precedent
(`util.ts:168-204`).

Material uncertainty: none.
