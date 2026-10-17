## Hunt 2026-10-13: uncommitted diff on `fix/read-path-h4-bypass` against `1bc6b791` (7 files)

Verdict: the new CHANGELOG Security entry says `search_text` can no longer
leak through a swapped final symlink, but on Windows it still can.

### Confirmed

- Minor: [`CHANGELOG.md:30-38`](../../../CHANGELOG.md#L30-L38). The
  Security bullet's lead says the leak "can no longer" happen, and its body
  says every read "refuses a swapped final symlink".
  - Trigger: on Windows, a final path component swapped for a symlink
    between validation and open in `search_text`.
  - Impact: Windows operators are told the leak is closed when, for that
    swap, it is not. The code change does not make Windows worse than
    before.
  - Ruled out:
    - [`read.ts:20-21`](../../../src/core/read.ts#L20-L21): "Absent
      (undefined at runtime, despite @types/node) on Windows; 0 is a
      no-op."
    - `#assertFdWithinRoots` returns early when the
      `/proc/self/fd` readlink fails (`catch { return; }`,
      [`fs.ts:95-98`](../../../src/core/fs.ts#L95-L98)).
  - Fix: scope the claim by platform. For example: "refuses a swapped
    final symlink (Linux and macOS) and, on Linux, re-checks the opened
    file's real location; on Windows, creating symlinks needs privilege,
    and this residual is the one `path.ts`'s TOCTOU note records."

### Suspected

None.

### Questions

None.

### Dismissed

- `src/core/search.ts` `scanFile`: an abort during validation now
  rethrows instead of counting the file as inaccessible. Tell, not a
  defect: an aborted search should stop, and every other read path
  already works this way.
- `src/core/search.ts` `scanFile` and `src/core/fs.ts` `countFileLines`:
  a FIFO swapped in can block the open (no `O_NONBLOCK`). Tell, not a
  defect: `readFile(entryPath)` and `fsOpen(..., READ_NOFOLLOW)` blocked
  the same way before; the plan's Notes defer this.
- `src/tools/create.ts:276-284`: the append result now validates the path
  three times (stat, sample, count). Tell, not a defect: correct, and the
  cost is three lexical checks plus realpaths on one file.
- `__tests__/high-severity-fixes.test.ts` ancestor-swap test: `rm(dir)` on
  a symlink to a directory. Killed at plan-hunt; the repo already does
  this at `__tests__/mutation-regressions.test.ts:283-295`.
- Brief tells at `__tests__/high-severity-fixes.test.ts:107,114` (MARKER)
  and `src/tools/create.ts:248` (LOOSE): pre-existing lines outside this
  diff.

### Coverage

- Read fully: every changed hunk and its enclosing function in
  `src/core/fs.ts` (`readFile`, `readLeadingSample`, `countFileLines`,
  `open`, `stat`, `#assertFdWithinRoots`), `src/core/read.ts`
  (`readFileWithStats`), `src/core/search.ts` (`ScanContext`, `scanFile`,
  the `scanCtx` literal), `src/tools/read.ts` (`readOnePath`,
  `collectFileBudget`), `src/tools/create.ts` (append result block), and
  both test files' changed `describe` blocks.
- Blast radius pulled in: `src/tools/define.ts:46` (`ToolCtx.fs` type);
  `searchContent`'s test callers (`tools.test.ts:3140-3163`,
  `core-fs.test.ts:729-775`), whose signature is unchanged.
- Not audited, and why: the unchanged regions of the 7 files, which this
  diff does not touch. The brief's blast-radius hits under
  `.claude/worktrees/` are stale agent worktrees, not this repo's code.
- Taken on trust: Node's `FileHandle.readFile({ signal })`, `fs.rm` on a
  symlink, and that `/proc/self/fd` readlink returns the opened file's
  real path on Linux.

## Re-check 2026-10-13: after the review fixes

- The Confirmed Minor at `CHANGELOG.md` is fixed. The bullet now says the
  final-symlink refusal holds on Linux and macOS, and that Windows keeps
  the residual swap window.
