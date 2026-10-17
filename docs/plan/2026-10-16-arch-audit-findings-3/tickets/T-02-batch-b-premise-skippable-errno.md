---
kind: frontier-ticket
id: T-02
title: Batch B premise - is the skippable-errno EPERM divergence live?
map: M-01
status: closed
type: research
mode: afk
priority: 100
blocked_by: []
claimed:
---

## Question

Does finding 2 of [the audit asset](../assets/audit-findings.md) hold live:
does `SKIPPABLE_ERRNOS` still omit EPERM while `SKIPPABLE_FS_CODES` treats
its mapped code as skippable, and does the derivation move change only
EPERM-class behavior? Unblocks [batch B delivery](T-09-deliver-batch-b-skippable-errno.md).

## Research context

- Unblocks: batch B delivery (T-09) — derive the errno set from
  `ERRNO_MAP x SKIPPABLE_FS_CODES`.
- Starting sources: `src/core/errors.ts` `ERRNO_MAP` and both skippable sets
  (audit cites `:77-78`, `:100-106`); every `isSkippableErrno` consumer
  (`src/core/path.ts:308-318` `isEntryAccessible`,
  `src/core/path-completer.ts:130`, `src/tools/replace-text.ts` import —
  grep for all).
- Scope and evidence: cite `file:line` for every claim; enumerate every
  consumer; confirm a concrete reachable path where an unwrapped EPERM skips
  nothing today (name the call chain); confirm deriving the set adds exactly
  EPERM to the skippable errnos and changes nothing else; check both refuted
  lists (map Notes) for collisions. A refuted or shifted premise is a failed
  return, not an adaptation.

## Resolution

LIVE. Set omission exact (`errors.ts:106` vs `:97-104`; `ERRNO_MAP` `:78`).
Derivation delta = EPERM only; nothing else can enter (no errno maps to
ACCESS_DENIED). Symptom corrected: `path.ts:317` has no live raw-EPERM path
(`handleRealpathError` wraps first, `path.ts:559-593`); the live impact is
path-completer warn-noise (`path-completer.ts:134-136`) and replace-text
recording raw EPERM as a per-file failure where EACCES is skipped
(`replace-text.ts:326-338`). Consumers exhaustive: `errors.ts:193-194`,
`path.ts:317`, `path-completer.ts:135`, `replace-text.ts:333`. No
refuted-list collision. Flag for batch B: findings-2 finding 4 (inline
`isEntryAccessible`) has an unverified ship status — re-grep at delivery.

Material uncertainty: none beyond that flag.
