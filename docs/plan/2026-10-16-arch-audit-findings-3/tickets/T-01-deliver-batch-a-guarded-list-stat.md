---
kind: frontier-ticket
id: T-01
title: Deliver batch A - list's size stat through the guarded call (finding 1)
map: M-01
status: closed
type: task
mode: afk
priority: 10
blocked_by: []
claimed:
---

## Question

Deliver finding 1 of [the audit asset](../assets/audit-findings.md): the only
security-adjacent finding, shipped alone as its own PR before every other
batch (map Notes).

- Current: `src/tools/list.ts:1` imports `stat` from `node:fs/promises`;
  `src/tools/list.ts:142` reads
  `size = (await withAbort(stat(entry.path), options.signal)).size`.
- Record: `docs/plan/2026-10-15-list-sizes/list-sizes.plan.md:26` and `:378`
  bless the guarded `options.fs.stat(entry.path, { signal })`; the plan's
  comment already sits at `list.ts:145`.
- Move: swap the call to `options.fs.stat(entry.path, { signal:
  options.signal })`; delete the raw import (and `withAbort` there if it has
  no other use in the file).
- Rejected move (do not do): an unvalidated `entryStat` variant on
  `GuardedFileSystem`.

Drift check first: `git diff 35c0daa0..HEAD -- src/tools/list.ts` — any
change to the sizes path is a STOP for re-reading, not an adaptation.

PR: own branch, CHANGELOG entry under Security (fifth-audit T-03 precedent),
existing `#99` sizes tests must stay green; no new surface, so the contract
snapshot must stay untouched. Completion check per the map's execution
contract; resolution links the PR.

## Resolution

Delivered under the map's execution contract. Drift check clean (HEAD ==
`35c0daa0` at start). The sizes stat now goes through the guarded
filesystem (`options.fs.stat`); collect's options gained a `fs:` field, and
the raw `node:fs/promises` stat import and `withAbort` wrapper are gone. One
deviation from the plan record's literal shape: the plan's excerpt assumed the
options already carried the guarded filesystem — they carried only
`pathGuard`, so `ctx.fs` is threaded in as a new field. Completion check:
`npm run check` → exit 0. Contract snapshot untouched.

Classification: Delivered. PR:
https://github.com/j0hanz/filesystem-mcp/pull/106
