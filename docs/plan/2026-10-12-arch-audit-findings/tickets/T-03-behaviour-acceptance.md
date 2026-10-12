---
kind: frontier-ticket
id: T-03
title: Are the two visible behaviour changes acceptable?
map: M-01
status: closed
type: grilling
mode: hitl
priority: 100
blocked_by: []
claimed: 2026-10-12T00:00:00Z
---

## Question

Are the two user-visible behaviour changes acceptable as stated in
[audit findings](../../assets/audit-findings.md)?

- Finding 1: an externalized result near the 10 MiB outbound cap now refuses
  as too-large-to-cache instead of caching and later overflowing the stdio
  read buffer.
- Finding 7: `replace_text`'s too-large message changes wording once, from
  the hand-rolled `File too large: <path> (<size> bytes > <max> bytes)` to
  the owner's `createTooLargeError` message.

The 2026-10-02 precedent is one acceptance decision covering both visible
changes, taken before delivery started.

## Resolution

Confirmed with the user: **both accepted**. Both are refusal-path changes
only; no successful call changes shape.

- Finding 1: an externalized result between roughly 9.75 MiB and 10 MiB
  answers `TOO_LARGE` with "Resource too large to cache (N bytes)" at
  creation (`store.ts:131` refuses through the existing path) instead of
  caching and risking the stdio read-buffer overflow on read-back.
- Finding 7: `replace_text`'s refusal becomes "File exceeds size limit (N >
  M bytes)" (`read.ts:102`) with the path carried in the error envelope —
  the same wording read and append already use.

Material uncertainty: none.