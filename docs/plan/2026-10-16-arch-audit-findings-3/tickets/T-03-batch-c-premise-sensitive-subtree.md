---
kind: frontier-ticket
id: T-03
title: Batch C premise - do find_files and search_text surface subtrees under denylist-named directories?
map: M-01
status: closed
type: research
mode: afk
priority: 100
blocked_by: []
claimed:
---

## Question

Does finding 3 of [the audit asset](../assets/audit-findings.md) hold live:
do `find_files` and `search_text` return paths (and does `searchContent`
search contents) under a directory whose own name matches a denylist name
pattern, while `list` hides the whole subtree? And what seam should the
shared prune use? Unblocks [batch C delivery](T-10-deliver-batch-c-sensitive-walk.md).

## Research context

- Unblocks: batch C delivery (T-10) — prune sensitive directories in the
  shared walk (`glob.ts` filter), delete `list.ts:131-134`'s ancestor loop.
- Starting sources: `src/tools/list.ts:131-137`; `src/core/search.ts`
  searchFiles (`:640-695` audit cite) and searchContent; `src/core/glob.ts`
  `createWalkFilter` / `GlobEntriesOptions` (what the filter receives, whether
  it can prune descent); `src/core/path.ts:295-297`, `:847-856`, `:981-990`
  (`isSensitive`, `assertNotSensitiveFile`, the re-spelling gate).
- Scope and evidence: settle the premise EMPIRICALLY — a temp fixture
  (directory whose name matches a name pattern; `--deny` is fine) driven
  through the real tools is the strongest evidence; report the exact
  observed behavior per tool. Confirm the guard checks no ancestor name for
  a fully-existing entry. Then read the `glob.ts` filter and recommend
  param-vs-callback for the prune (what lands under Not yet specified on the
  map). Cite `file:line` for every claim; check both refuted lists for
  collisions. A refuted premise is a failed return.

## Resolution

LIVE, confirmed empirically end-to-end (shipped v2.9.0 server over stdio:
`list` hides the `keys.pem/` and `vaultdir/` subtrees; `find_files` returns
both files; `search_text` matches their contents) and at engine level (the
guard passes `validateExistingPath` on both files; `globEntries` yields
them). The guard never checks an existing ancestor's name; name-pattern
denies are the gap — path globs already cover descendants.

Seam decided: an optional `pathGuard?: Pick<PathGuard, 'isSensitive'>` field
on `GlobEntriesOptions` (`glob.ts:448-466`), threaded into `createWalkFilter`
(`:629-635`) — `prune` gains `match.isDirectory() &&
pathGuard.isSensitive(absoluteOf(match))` (stops descent, `:686`), and
`isExcluded` gains the same test (drops the dirent fs.glob still yields,
`:698-701`). Callers passing it: `list.ts:104`, `search.ts:486`,
`search.ts:626`, `replace-text.ts:504` (search previews replace's files, so
they must match). NOT `move.ts:521` — `assertTreeHasNoProtectedEntries` must
see sensitive entries; the option stays opt-in. Probe scripts live in
`C:\tmp\fsmp-probe\`, fixture in `C:\tmp\fsmp-fixture\`.

Material uncertainty: path-pattern descendant coverage is compiler-derived,
not run empirically; it bounds the finding to name patterns, as claimed.
