---
kind: frontier-ticket
id: T-09
title: Deliver batch B - derive the skippable errno set (finding 2)
map: M-01
status: open
type: task
mode: afk
priority: 100
blocked_by: [T-02]
claimed:
---

## Question

Deliver finding 2 per [the audit asset](../assets/audit-findings.md), only
after [its premise](T-02-batch-b-premise-skippable-errno.md) resolved
live: replace the hand-maintained `SKIPPABLE_ERRNOS` in `src/core/errors.ts`
with a set derived from `ERRNO_MAP x SKIPPABLE_FS_CODES`, keeping the comment's
meaning at the declaration. Behavior change (raw EPERM becomes skippable):
add a pin test for the newly-skipped EPERM path and a CHANGELOG entry. Drift
check first (`git diff 35c0daa0..HEAD -- src/core/errors.ts`); a premise
mismatch is a STOP. Own PR; contract completion check; resolution links the
PR and names the CHANGELOG wording.


Amendment 2026-10-16, from [the premise resolution](T-02-batch-b-premise-skippable-errno.md):
the audit's "kills a whole listing" framing is refuted — `path.ts:317` wraps
raw EPERM as FsError first. The pin tests target the corrected impact: the
path completer stops warning on raw EPERM (`path-completer.ts:134-136`), and
replace-text stops recording raw EPERM as a per-file failure where EACCES is
skipped (`replace-text.ts:326-338`). CHANGELOG wording follows that impact,
not the audit's original sentence.
