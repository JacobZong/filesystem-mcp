---
kind: frontier-ticket
id: T-19
title: Deliver the #108 follow-up - hide sensitive ancestors in the walk filter
map: M-01
status: closed
type: task
mode: afk
priority: 10
blocked_by: []
claimed:
---

## Question

Deliver the fix for the two PR #108 review findings (Codex P1, Copilot
High), both verified live by engine-level probe on merged main:

- Literal sensitive prefixes (`vault.key/*.txt`, `vault.key/**`, an exact
  path) — Node's fs.glob never consults `exclude` for literal path
  components, so the batch C descent prune never fired; `find_files`
  returned and `search_text` matched `keys.pem/inner.txt` through the guard.
- A denylisted symlink standing in for a directory (`alias.key -> clean/`)
  — the dirent is not `isDirectory()`, so the prune missed it, and the walk
  followed it (`alias.key/sub` yielded) while the guard passes descendants
  resolved through the link.

Move: an ancestor-name check in the walk filter — every yielded entry and
  every prune ask is tested against its directory ancestors (cached per
  prefix), so the hide holds whatever the pattern spelled. The entry's own
  final name stays with the per-entry guard every caller already runs. Pin
  tests: literal-prefix `find_files`/`search_text` asserts, and a
  sensitive-named symlink (junction on Windows) subtree test.

Priority 10: closes a security gap on merged main; user flagged the review
finding as worth addressing.

## Resolution

Delivered. Both findings verified by engine-level probe on merged main
(literal-prefix yields + guard pass; symlink follow + descendant matches), then
fixed with a cached ancestor-name check in the walk filter (`sensitiveTree`,
applied in `prune` and `isExcluded`). Red-then-green: two literal-prefix pins
and a sensitive-named symlink subtree test fail on main, pass with the fix.
The entry's own final name stays with the per-entry guard. CHANGELOG Security
bullet extended. Completion check: `npm run check` → exit 0. Contract snapshot
untouched.

Classification: Delivered. PR:
https://github.com/j0hanz/filesystem-mcp/pull/110
