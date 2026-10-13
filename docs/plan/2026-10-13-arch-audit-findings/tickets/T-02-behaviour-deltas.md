---
kind: frontier-ticket
id: T-02
title: What exactly changes in behavior for findings 3, 10, 12 and 15?
map: M-01
status: closed
type: research
mode: afk
priority: 10
blocked_by: []
claimed:
---

## Question

For findings 3, 10, 12 and 15, what observable behaviour changes when the
stated move lands, and which existing tests pin the current behaviour?

Priority 10: the behaviour-acceptance decision waits on it.

## Research context

- Unblocks:
  [Are the visible behavior changes acceptable?](T-04-behaviour-acceptance.md)
- Starting sources: [audit findings](../assets/audit-findings.md)
  findings 3, 10, 12 and 15; `src/tools/edit.ts`, `patch.ts`, `create.ts`;
  `src/core/file-uri.ts`; `src/server.ts:70-110`; `src/transport/stdio.ts`
  and `http.ts`; `src/resources.ts` (cacheScope readers);
  `src/core/path-completer.ts`; `src/core/path.ts:59-102,350-430,574-594`;
  `__tests__/contract.test.ts` and its `.snapshot`.
- Scope, per finding:
  - 3: does any test or snapshot assert that the `resourceUri` key is
    present, not just its value? Does `structuredContent` differ?
  - 10: where `cacheScope` is read, and what a client sees on stdio with
    and without `FS_API_KEY`. Would dropping it on stdio change anything
    visible?
  - 12: which completion inputs the guard rejects that the completer
    accepts today (device names, sensitive files, drive-relative paths),
    and which tests cover completion.
  - 15: the exact inputs (missing target, EACCES, symlinked boundary) on
    which `isWithinBoundary` and `partitionRootsWithin` disagree today,
    and which grant and seeding tests cover them.
- Evidence: `file:line` per claim. No code edits.

## Resolution

Two of the moves, implemented as the audit wrote them, would break
behaviour. Each needs a constraint. Key citations were re-opened before
closing this ticket.

- **3: nothing breaks.**
  - edit and patch would hold `resourceUri: undefined` as a key, as
    `create.ts:335` already does; JSON drops it on the wire. The key
    order in patch changes, and nothing asserts key order.
  - No test checks that the key is present (`tools.test.ts:480`,
    `sandbox.test.ts:220`, `core-fs.test.ts:593,609` all check values).
  - The audit's patch line numbers are stale: the copy is at
    `src/tools/patch.ts:155-163`.
- **10: visible only on stdio with `FS_API_KEY` set.**
  - `cacheScope` is read for 4 list/discover operations
    (`src/server.ts:113-125`), the instructions resource
    (`src/resources.ts:151`) and the file template (`resources.ts:202`).
  - The SDK serialises cache hints only on 2026-era responses, so legacy
    clients see nothing either way.
  - Today a stdio server with `FS_API_KEY` set reports `private`, though
    bearer auth exists only on HTTP. If stdio passes `public`, a modern
    stdio client with the key set sees `private` turn into `public`. If
    stdio keeps deriving the scope from the key, nothing changes.
  - No test asserts `private` for an API-key server; the contract
    snapshot holds no `cacheScope`.
- **12: one real tightening, and one constraint.**
  - The tightening: a directory whose own name is sensitive (`.env`,
    `x.key`, or a `--deny` match) gets its children listed today, because
    `src/core/path-completer.ts:146` filters each child by its basename
    only. After the move, nothing in that directory is listed.
  - The debug log for ENOTDIR, EPERM and EIO goes away.
  - **Constraint:** the guard throws where the completer returns false.
    An unwrapped call reaches the catch at `path-completer.ts:205-210`
    and drops the root suggestions too. The call must be wrapped so any
    `FsError` returns false.
  - No test covers sensitive directories; nothing breaks.
- **15: one outcome changes, and one constraint.**
  - Callers are `precheckAccess` (`src/core/path.ts:356`, existing
    directories only) and `applyGrant` (`:383`, which also receives
    legacy stdio seeded roots that may be missing,
    `src/transport/stdio.ts:107`). `applyGrant`'s recompute already ends
    on `partitionRootsWithin`'s answer.
  - The only changed outcome: a missing seeded root spelled through a
    symlinked boundary goes from refused to granted.
  - **Constraint:** keep the `rootBoundaries.length === 0` early return
    (`path.ts:416-418`). `partitionRootsWithin` with no boundaries drops
    everything, which would break TC-PG-005/005b/006, GUARD-005 and
    TC-ROOTS-001/002.
  - No test passes a missing, EACCES or symlinked-boundary target to the
    grant paths. A pin test is needed first.

Material uncertainty: for finding 12, reserved device names are inferred,
not run, to already fail at `stat` today.
