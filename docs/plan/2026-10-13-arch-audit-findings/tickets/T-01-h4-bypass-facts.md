---
kind: frontier-ticket
id: T-01
title: Is the H4 bypass real on all three read paths, and what test pins it?
map: M-01
status: closed
type: research
mode: afk
priority: 10
blocked_by: []
claimed:
---

## Question

Is finding 1's gap real on each of the three read paths (`search.ts`
`scanFile`, the `tools/read.ts` known-stats branch, `fs.ts`
`readLeadingSample`)? Can a symlink or ancestor swapped in after
validation make each one return bytes from outside the roots? And what
existing test shape can pin each path?

Priority 10: the security-fix decision and the batching both wait on it.

## Research context

- Unblocks:
  [Does finding 1 ship as a security fix, separately and first?](T-03-security-fix-first.md)
- Starting sources: `src/core/path.ts:157-164` (the TOCTOU note);
  `src/core/fs.ts` (`#assertFdWithinRoots`, `readFile`, `open`,
  `readLeadingSample`); `src/core/read.ts` (`readFileWithStats`,
  `openReadableFileHandle`); `src/core/search.ts` (`scanFile`,
  `searchContent`); `src/tools/read.ts:170-235,290-330`; commit
  `db1474dd`; `__tests__/high-severity-fixes.test.ts` (H4 describe) and
  the symlink tests in `__tests__/core-fs.test.ts`.
- Scope, per path:
  - which guard calls run between validation and the byte read;
  - whether a final-component swap and an ancestor swap each escape, on
    Linux and on Windows;
  - whether a client can open the swap window or only a local attacker;
  - which existing test the regression test should copy.
  - Also: does reading through a handle in `scanFile` change cost per
    file (one open versus stat plus readFile)?
- Evidence: `file:line` for every claim. No code edits.

## Resolution

Real on all three paths, with different reach. No race was run; the
answer comes from reading the code, and every citation was re-opened
before closing this ticket.

| Path | Final-component swap | Ancestor swap | What leaks |
| :--- | :--- | :--- | :--- |
| `search.ts` `scanFile` | escapes, all OSes | escapes, all OSes | file content as match lines |
| `tools/read.ts` known branch | refused on POSIX | escapes on Linux | file content |
| `fs.ts` `readLeadingSample` | refused on POSIX | escapes on Linux | MIME type and kind only |

- `scanFile` (`src/core/search.ts:271,277,285`) validates and then throws
  the result away. It reads `entryPath` by name with plain
  `fsStat` and `readFile`: no `O_NOFOLLOW`, no fd check. A pattern like
  `.` returns the swapped-in file up to `maxResults`. Its only caller is
  `src/tools/search-text.ts:241`. `searchContent` takes a `PathGuard`, not
  a `GuardedFileSystem` (`search.ts:345-349`), so the move changes its
  signature.
- The known-stats branch runs only for a `paths` batch entry whose stat
  succeeded and that fits the budget (`src/tools/read.ts:186-232,
  360-366`). It opens with `O_NOFOLLOW` (`src/core/read.ts:18-25`) but
  passes no `verifyHandle`. The window is wide: the whole batch is stat'd
  before any file is read.
- `readLeadingSample` (`src/core/fs.ts:350-360`) has one caller,
  `src/tools/create.ts:280` (append).
- **A fourth path the audit missed:** `countFileLines` (`fs.ts:89-90`,
  called at `create.ts:284`) opens with `READ_NOFOLLOW` and runs no
  validation and no fd check. It leaks a line count. Finding 1's move
  should cover it.
- On Windows and macOS the fd re-check is a no-op everywhere
  (`fs.ts:127-148` reads `/proc/self/fd`). There, paths 2 and 3 are no
  worse than the guarded reads.
- **Who can exploit it:** a local process with write access inside a
  root. A client using only this server's tools cannot: no tool creates a
  symlink, and `move` validates its source before moving
  (`src/tools/move.ts:455`).
- **Test to copy:** `__tests__/high-severity-fixes.test.ts:327-409` (the
  rename-flipper with a POSIX skip). It catches `scanFile` through
  `searchContent` and the batch read through `callTool`. No test swaps an
  ancestor directory, so paths 2 and 3 need a new Linux-only
  directory-flip variant. Both tests are probabilistic (400 iterations).
- **Cost:** reading through a handle in `scanFile` costs about the same
  per file. Trap: `GuardedFileSystem.open` re-validates (`fs.ts:460`),
  so drop the validation at `search.ts:271` rather than run it twice.

Material uncertainty:
- Whether `fs.glob` dirents report `isFile()` false for symlinks
  (`src/core/glob.ts:550`). If they do, in-root symlinks never reach
  `scanFile` through the walk. This affects scope, not the gap.
- Windows junctions may allow an unprivileged ancestor swap. Not
  verified.
