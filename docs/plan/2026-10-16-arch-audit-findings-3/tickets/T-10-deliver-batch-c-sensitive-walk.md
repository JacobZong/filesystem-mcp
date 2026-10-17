---
kind: frontier-ticket
id: T-10
title: Deliver batch C - prune sensitive directories in the shared walk (finding 3)
map: M-01
status: closed
type: task
mode: afk
priority: 100
blocked_by: [T-03]
claimed:
---

## Question

Deliver finding 3 per [the audit asset](../assets/audit-findings.md), only
after [its premise](T-03-batch-c-premise-sensitive-subtree.md) resolved live
and named the seam (param vs callback, from the map's Not yet specified):
prune sensitive directories once in the `glob.ts` walk filter backed by
PathGuard; delete `list.ts:131-134`'s ancestor loop; find_files and
search_text inherit the prune. Behavior change (denylist-named subtrees newly
hidden from find_files/search_text): pin tests per the premise's fixture, and
a CHANGELOG entry. Drift check first; a premise mismatch is a STOP. Own PR;
contract completion check; resolution links the PR, names the seam used and
the CHANGELOG wording.


Amendment 2026-10-16, from [the premise resolution](T-03-batch-c-premise-sensitive-subtree.md):
seam decided — an optional `pathGuard?: Pick<PathGuard, 'isSensitive'>` field
on `GlobEntriesOptions`, threaded into `createWalkFilter`; `prune` and
`isExcluded` both gain the sensitive-directory test. Pass it from `list.ts:104`,
`search.ts:486` (searchContent), `search.ts:626` (searchFiles), and
`replace-text.ts:504`. Do NOT pass it from `move.ts:521` — that walk must see
sensitive entries. Pin tests reuse the premise's fixture shape
(name-pattern-denied directories; probe scripts in `C:\tmp\fsmp-probe\`).

## Resolution

Delivered under the map's execution contract, per the T-03 seam decision.
`GlobEntriesOptions` gained an opt-in `pathGuard?: Pick<PathGuard,
'isSensitive'>`; `createWalkFilter` gained a `sensitiveDir` test applied in both
`prune` (stops descent) and `isExcluded` (drops the dirent fs.glob still
yields); list's ancestor loop is deleted; searchContent, searchFiles and
replace-text pass the option; move's protected-entries walk does not. Pin:
the existing surface test's fixture gained a token-bearing file under a
denylisted-named directory (`vault.key`), its find_files/replace asserts
tightened, red-then-green via stash. T-02-style flags: none this batch.
Completion check: `npm run check` → exit 0. Contract snapshot untouched.

Classification: Delivered. PR:
https://github.com/j0hanz/filesystem-mcp/pull/108
