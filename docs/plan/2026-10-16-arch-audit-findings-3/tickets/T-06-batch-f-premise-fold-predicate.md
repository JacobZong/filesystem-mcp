---
kind: frontier-ticket
id: T-06
title: Batch F premise - Unicode fold mirror and legacyHttp predicate, live?
map: M-01
status: closed
type: research
mode: afk
priority: 100
blocked_by: []
claimed:
---

## Question

Do finding 7 and finding 8 of [the audit asset](../assets/audit-findings.md)
hold live: the Unicode fold re-implemented in two files, and the
stateless-legacy-HTTP predicate duplicated? Unblocks [batch F delivery](T-13-deliver-batch-f-fold-predicate.md).

## Research context

- Unblocks: batch F delivery (T-13) — one fold primitive in `path-utils.ts`;
  one `legacyHttp` computation in `createServer` threaded through deps.
- Starting sources: `src/core/path-utils.ts:203` (`unicodeMatchKey`),
  `src/core/sensitive.ts:34-35` (`foldForMatch`) and its mirror comment;
  `src/server.ts:95`, `src/resources.ts:536` (predicate),
  `src/tools/define.ts:175-176` (third encoding).
- Scope and evidence: confirm cites verbatim. For the fold: confirm the two
  case modes differ deliberately (platform fold vs always-lowercase) and a
  shared NFC + `\p{Zs}` primitive serves both with each site keeping its case
  mode — name the primitive's home and signature. For the predicate: confirm
  both sites are verbatim-identical, name the deps threading path
  (`createServer` to `registerResources`/tools), and confirm the third
  encoding in define.ts is genuinely the same rule or a different one. Check
  both refuted lists (sixth audit shipped `MODERN_PROTOCOL_REVISION` re-export
  work — confirm no collision). Cite `file:line` for every claim.

## Resolution

Split. Finding 7 (fold): LIVE — cites verbatim (`path-utils.ts:202-203`,
`sensitive.ts:32-37`); the case modes differ deliberately
(`path-utils.ts:180-183` platform fold vs `sensitive.ts:20-21`
always-lowercase); a shared primitive `foldUnicodeSpelling(name)` in
path-utils serves both with each site keeping its case mode; no cycle; no
refuted-list entry touches the fold. Finding 8 (predicate): SHIFTED — the
duplication is live but the move is record-refuted: `docs/adr/002-legacy-protocol-paths-sunset.md:108-110`
deliberately blesses the predicate spelled twice rather than passed through
deps (the sixth audit's finding 8 already excluded unification; the seventh
audit missed the record). `define.ts:176` is a different, weaker rule — do
not unify. Batch F re-scoped to the fold half at redraw.

Material uncertainty: none.
