# Seventh architecture audit findings — 2026-10-15, at `35c0daa0`

Report delivered in chat 2026-10-15 (four zone probes through the repo's own
filesystem-mcp tools, cross-zone edges walked, both prior assets' refuted
lists checked). This asset is the durable record; batch tickets link into it.
Audit memory: `arch-audit-2026-10-15`.

Import graph walked: core imports nothing upward, tools imports only
`../core/*`, transport imports core + the `server.ts` factory (ADR-002/003
bless). No cycles, no wrong-direction edge. All 12 findings below are
inferred unless a record is named.

## Findings, rank order

1. **`list` size stat skips the guard its plan names — Drift.**
   `src/tools/list.ts:142` reads
   `size = (await withAbort(stat(entry.path), options.signal)).size`, with
   `stat` imported raw from `node:fs/promises` (`list.ts:1`) — the only
   direct syscall import in `src/tools`. The shipped plan blesses the guarded
   form: `docs/plan/2026-10-15-list-sizes/list-sizes.plan.md:26` ("Sizes come
   from one guarded `ctx.fs.stat` per file entry") and `:378`
   (`options.fs.stat(entry.path, { signal })`), naming `GuardedFileSystem.stat`
   (`src/core/fs.ts:197-204`) as "the option this plan relies on". The
   implementation kept the plan's comment (`list.ts:145`) but swapped the
   call. `read.ts`'s budget stat — the plan's own exemplar — is guarded.
   Move: swap `list.ts:142` to `options.fs.stat(entry.path, { signal:
   options.signal })`; delete the raw import (and `withAbort` there if unused).
   Rejected move: an unvalidated `entryStat` variant on `GuardedFileSystem`
   ("entries already passed `isEntryAccessible`") — a second public stat
   spelling is what the drift already is.

2. **Skippable-errno set omits EPERM its twin treats as skippable — Ownerless,
   diverged.**
   `src/core/errors.ts:106`:
   `SKIPPABLE_ERRNOS = {ENOENT, EACCES, ELOOP}`; the comment above
   `SKIPPABLE_FS_CODES` (`errors.ts:100-104`) says "OS-level EACCES/EPERM ...
   exactly as skippable", and `ERRNO_MAP` maps EPERM to `PERMISSION_DENIED`
   (`errors.ts:78`), which the code set includes. An unwrapped EPERM reaching
   `isSkippableErrno` consumers (`path.ts:317` in `isEntryAccessible`,
   `path-completer.ts:130`, `tools/replace-text.ts` import) throws and kills a
   whole listing where EACCES is skipped.
   Move: derive the errno set from `ERRNO_MAP x SKIPPABLE_FS_CODES` — one
   declaration. Behavior change: raw EPERM becomes skippable.

3. **"A sensitive directory's subtree is hidden" — list-only rule —
   Ownerless.**
   `src/tools/list.ts:131-134` walks every ancestor through
   `isSensitive` and drops the subtree. The other walkers classify per entry
   (`core/search.ts` searchFiles `:640-695`, searchContent; find_files), and
   the guard checks only the entry's own path and final name — an existing
   entry under a directory whose name matches a denylist name pattern passes.
   `list` hides that subtree; `find_files`/`search_text` return its paths,
   `searchContent` searches its files. No plan record blesses the asymmetry
   (searched `docs/`; `path.ts:983`'s "a directory `list` would refuse is never
   read" acknowledges list's walk, not the gap).
   Move: prune sensitive directories once in the shared walk — `globEntries`
   filter gains a PathGuard-backed prune; delete list's ancestor loop.
   Behavior change: find_files/search_text hide subtrees they used to surface.
   Seam shape (param vs callback) open until the premise return.

4. **Base64 wire-cost formula re-derived x3 — Ownerless.**
   `4 * Math.ceil(n / 3)` at `src/core/file-uri.ts:121`, `src/resources.ts:238`,
   `src/tools/read.ts:212`. Fresh (#74 binary reads, #105).
   Move: `base64EncodedBytes(size)` in `core/util.ts` beside `jsonByteBound`.
   The refuted list pins the wire-limit PROSE, not this formula — prose stays,
   the arithmetic hoists.

5. **`search.ts` scan drivers duplicate the collect-replay ladder —
   Duplication.**
   `searchContent` (`core/search.ts:518-570`) and `searchFiles` (`:640-695`)
   both hand-write the `perFile` Map keyed by `dispatched - 1`, ordered replay,
   counters, and the `resolveStopReason` call — ~50 duplicated lines on a file
   with four recent commits.
   Move: an ordered-collect driver in `concurrency.ts` parameterized by
   runEntry; both drivers shrink to per-file logic. Net ~-35.

6. **PathGuard recompute pair retyped 19 times — Ownerless (tests).**
   `new PathGuard({ cliAllowedDirs: [root] }); await
   guard.recomputeAllowedDirectories();` x19 across `__tests__/guards.test.ts`
   and `__tests__/path-guard-grant.test.ts`; `helpers.ts:157` `makeGuard`
   covers only the env-free variant.
   Move: `makeRecomputedGuard(dirs)` in helpers (or a `makeGuard` option).

7. **Unicode fold mirrored in two files — Ownerless.**
   `path-utils.ts:203` (`unicodeMatchKey`: NFC + `\p{Zs}`-space + platform
   case-fold) and `sensitive.ts:34-35` (`foldForMatch`: same NFC + Zs,
   always-lowercase) — sensitive.ts's comment says it mirrors the guard's
   fold; it re-implements it. Change one fold and the denylist silently stops
   matching the names the guard re-spells.
   Move: one fold primitive in `path-utils.ts`; each site keeps its case mode.

8. **Stateless-legacy-HTTP predicate duplicated — Ownerless.**
   `era === 'legacy' && notifier !== undefined` verbatim at `server.ts:95`
   and `resources.ts:536`, each with a long comment re-explaining the rule; a
   third encoding at `tools/define.ts:175-176`.
   Move: compute once in `createServer`, thread via the deps both registrars
   already receive.

9. **Stacked single-use validators in `cli.ts` — Middleman.**
   `validateDirectoryPath` (`cli.ts:62`, sole caller `:89`) and
   `normalizeAndValidateDirs` (`:83`, sole caller `:210`) — delete either in
   your head and nothing reappears. Move: fold into callers. Net ~-12.

10. **One-caller hop in path-completer — Middleman.**
    `resolveNamedRootContext` (`core/path-completer.ts:43`, sole caller
    `:153`) adds no rule its caller doesn't know. Move: inline 6 lines.

11. **sha256 chain x3 in `read.ts` — Ownerless (local).**
    `createHash('sha256').update(...).digest('hex')` at `tools/read.ts:275`,
    `:346`, `:377`. Move: local `sha256Hex`. Net ~-2.

12. **SSE response parse copied in two tests — Ownerless (tests).**
    Identical 5-line event-stream parse at `__tests__/cli.test.ts:170-176`
    and `input-required.test.ts:608-614`; `input-required` already half-owns
    it inside `callHttp` (`:585`). Move: `responseJson` in helpers.ts.

## Dropped at pricing — do not re-propose

- Edit-vs-create duplicate-entry predicate (`edit.ts:105` `isSamePath` vs
  `create.ts:94` `isEquivalentPath`) — record `e652070d` blesses aliased batch
  entries applying in turn under `lockForWrite`.
- Sensitive-refusal prose-match (`search.ts:388,660`
  `message.startsWith('Sensitive file')`) — no net-deletion move; the
  consequence is summary-counter misclassification only.
- Dry-run tag literal x5; http-policy purity header; default HTTP bind
  `127.0.0.1` x2 — below the bar.
- Written-file value shape (create.ts:54, edit.ts:117, patch.ts:21) — the
  findings-2 refuted list blesses per-tool envelope construction; reopens via
  write-adr only when its "fourth stat policy" trigger fires.

## Standing context

- Refuted lists governing all future audits:
  `docs/plan/2026-10-12-arch-audit-findings/assets/audit-findings.md` and
  `docs/plan/2026-10-13-arch-audit-findings-2/assets/audit-findings.md`.
- Fifth-audit delivery lesson: verify each premise against current code
  BEFORE editing; a mismatch is a STOP, not an adaptation.
- Prior audit history and shipped owners: memory `arch-audit-2026-10-15`
  (seventh), `-sixth`, `-reaudit`, `arch-audit-2026-10-13`, `arch-audit-2026-10-12`,
  `arch-audit-2026-10-02`.

## Premise verification, 2026-10-16 (map tickets T-02..T-08)

- Finding 2: LIVE, symptom corrected — no listing-kill via `path.ts:317`
  (raw EPERM is FsError-wrapped first); the live impact is path-completer
  warn-noise and replace-text recording raw EPERM as a per-file failure
  where EACCES is skipped.
- Finding 3: LIVE, confirmed empirically on the shipped v2.9.0 server.
  Seam settled: an optional `pathGuard?: Pick<PathGuard, 'isSensitive'>`
  field on `GlobEntriesOptions`, applied in both `prune` and `isExcluded`;
  passed by list, searchContent, searchFiles, and replace-text; move's
  `assertTreeHasNoProtectedEntries` walk must NOT pass it. The gap is
  bounded to name-pattern denies — path globs already cover descendants.
- Findings 4, 11: LIVE verbatim; no fourth spelling of either pattern; the
  two extra `createHash` sites are http-policy's timing-safe compare, a
  different concern.
- Finding 5: DROPPED — measured ~20 shared orchestration lines and a driver
  netting ~0 to +8; fails the net-deletion gate (map ticket T-05). Do not
  re-propose without a new measurement.
- Finding 7: LIVE; primitive `foldUnicodeSpelling` in path-utils, each site
  keeps its case mode.
- Finding 8: DROPPED — record-refuted by
  `docs/adr/002-legacy-protocol-paths-sunset.md:108-110`, which deliberately
  blesses the predicate spelled twice; `define.ts:176` is a different,
  weaker rule, not a third spelling.
- Findings 9, 10: LIVE; cascade — `findAllowedRootByName` becomes single-use
  after the fold.
- Finding 6: LIVE, count 19 -> 16 strict pairs (18 awaited calls; 19 only
  counting `helpers.ts:234`); helper shape intact.
- Finding 12: LIVE; the half-owner is `post` in `input-required.test.ts`,
  not `callHttp` (no such name exists).
