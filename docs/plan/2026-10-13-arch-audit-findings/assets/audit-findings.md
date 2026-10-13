# Architecture audit findings, 2026-10-13, at `1bc6b791`

Fifth audit. Six zone probes (tools ×2, core ×2, top-level + transport,
tests). No value-import cycles; `src/core` imports nothing upward; no
registrar imports `server.ts`. Findings 1–6 and 9 of the
[2026-10-12 audit](../../2026-10-12-arch-audit-findings/assets/audit-findings.md)
were still open at audit time and are not repeated here.

Line numbers drift; re-grep before every edit.

## Findings, rank order

### 1. Three read paths skip the H4 descriptor re-check

- `src/core/path.ts:157-164` records that reads "open with O_NOFOLLOW … and
  re-check the fd's real path on Linux" (H4, `db1474dd`).
- `src/core/search.ts:269-289` `scanFile` validates, then reads by name with
  plain `fsStat(entryPath)` + `readFile(entryPath)`: follows symlinks, no
  fd check.
- `src/tools/read.ts:321-322`: the `known`-stats branch calls
  `readFileWithStats` from `core/read.ts` directly, past `ctx.fs`, with no
  `verifyHandle`.
- `src/core/fs.ts:350-360` `readLeadingSample` opens O_NOFOLLOW but never
  calls `#assertFdWithinRoots`.
- Rests on: the record at `path.ts:157-164` (Drift); the tools→core/read
  edge is a front-door bypass.
- Move: every read goes through `GuardedFileSystem`: `fs.readFile` takes
  optional `known` stats, `searchContent` reads via `fs.open()`,
  `readLeadingSample` uses `this.open()`, `readFileWithStats` un-exported
  with `verifyHandle` required. 5 files, net ≈ -5..-8.
  T-01 found a fourth path: `countFileLines` (`src/core/fs.ts:89-90`).
- Rejected move: add `verifyHandle` at each site: keeps the exported
  bypass, next reader repeats the gap.
- Overlaps M-01 finding 9 (`readLeadingSample` size param).

### 2. Tool deps declared four times

- `src/tools/define.ts:92-99` `ToolDeps`, `define.ts:150-153` `Pick` of all
  six fields, `src/tools/index.ts:52-60` `ToolRegistrarDeps`,
  `index.ts:63-70` field-by-field copy. `7abdfe99` and `918bb10a` each
  touched all four.
- Move: `ToolRegistrarDeps extends ToolDeps { readOnly? }`; pass `deps`
  through; `toToolCtx` takes `ToolDeps`. 2 files, net ≈ -17.

### 3. Written-file meta copied by hand three times

- `src/tools/edit.ts:306-312`, `src/tools/patch.ts:155-163`,
  `src/tools/create.ts:330-338` copy fields of `WrittenFileMeta`
  (`src/core/file-uri.ts:90-99`); edit/patch re-type it unlike
  `create.ts:54`.
- Move: `const { resourceLink, ...fileMeta } = meta`, spread it; inline
  `buildEditFileValue` (1 caller). 3 files, net ≈ -20.
- Behaviour: `resourceUri: undefined` stays as a key (JSON drops it).

### 4. `validateAccessAndSensitivity` wrapper

- `src/core/path.ts:428-437` is the sole caller of `validateAccess`
  (`:443`); stale comment `:439-442` ("Callers still `await` it"); wrong
  "Windows helpers" header at `:153`.
- Move: fold the two sensitivity asserts into `validateAccess`; delete the
  wrapper, comment, header. 1 file, net ≈ -15.

### 5. `parseArgs` result rebuilt twice

- `src/index.ts:91-100` and `:117-120` re-spread the parsed object;
  `src/cli.ts:220-228` re-declares its type.
- Move: type `runPrintConfig` from `parseArgs`, widen `RuntimeConfig`
  (`src/transport/shared.ts:21-26`) fields to `| undefined`, pass `parsed`
  through. 3 files, net ≈ -18.

### 6. `build()` bypassed in `errors.ts`

- `build()` (`src/core/errors.ts:31-38`) omits undefined keys; the same
  spreads are hand-written at `:57-60`, `:157-159`, and the `FsError`
  constructor `:256-261`.
- Move: widen `ProblemFactoryOptions` to `| undefined`; route all three
  through `build`. 1 file, net ≈ -10. No behaviour change.

### 7. One-caller `handleX` in paged tools

- `src/tools/list.ts:228-301`, `src/tools/find-files.ts:84-139`,
  `src/tools/search-text.ts:390-461`, plus `searchFilesOutput`
  (`find-files.ts:66-82`): pack a hand-typed object `run` unpacks.
- Move: inline each into its `run`. 3 files, net ≈ -30.

### 8. Non-blank refine written three times

- Owner `isBlank` + message at `src/core/schema.ts:14,22-23`; repeated at
  `src/tools/edit.ts:24-28`, `src/tools/replace-text.ts:54-60`,
  `src/tools/search-text.ts:44-50`.
- Move: `schema.ts` exports `nonBlankString(label)`; un-export `isBlank`.
  4 files, net ≈ -9.
- Behaviour (T-04): edit takes the shared wording for empty and blank.

### 9. `handleEditFile` wrapper

- `src/tools/edit.ts:373-387`, 1 caller (`:520`), only picks lock-or-not;
  `patch.ts:132-136` writes that inline. `EditFileOptions` repacks two args.
- Move: inline the ternary; pass `args` to `editOnce`. 1 file, net ≈ -13.

### 10. `createServer` receives the API key

- `src/server.ts:73-79` takes `apiKey` with a secret-justifying comment;
  only use `:102` derives `cacheScope`.
- Move: hosts pass `cacheScope`; delete the comment. 3 files, net ≈ -6.
- Behaviour (T-04): stdio always passes `public`; HTTP derives it.
- Overlaps M-01 finding 5 (`server.ts`).

### 11. stdio hand-builds a JSON-RPC error envelope

- `src/transport/shared.ts:34-38` says a second hand-built literal is how
  the legs drift; `src/transport/stdio.ts:310-318` hand-builds one
  (`92bdb2a7`).
- Move: `jsonRpcError` omits `id` when undefined; stdio calls it. 2 files,
  net ≈ -4. (The 10-13 ponytail skip was the `id: null` variant.)
- Overlaps M-01 finding 5 (`stdio.ts`).

### 12. Path completer rebuilds the guard's directory check

- `src/core/path-completer.ts:62-81` repeats containment/stat/realpath;
  `PathGuard.validateExistingDirectory` (`src/core/path.ts:574-594`) owns
  it plus device-name and sensitive checks.
- Move: completer calls the guard; un-export `resolveRealPath`. 2 files,
  net ≈ -15. Behaviour: completion gets stricter; a debug log goes.
  Constraint (T-02): wrap the guard call so a refusal returns false, or
  root suggestions are lost.

### 13. ADR-002 says "six" test files; grep returns 15

- `docs/adr/002-legacy-protocol-paths-sunset.md:57-60` vs
  `grep -l "createTestClientPair\|createLinkedPair" __tests__/*.ts`
  (minus `helpers.ts`) = 15.
- Move: replace the number with the grep. 1 file, net 0.

### 14. replace-text failure counted at two sites

- `src/tools/replace-text.ts:316-321` and `:552-556` both bump
  `failedFiles` + `recordFailure`; `ReplaceContext.options` (`:247`)
  packed only to unpack.
- Move: `recordFailure(summary, path, error)` owns the count; flatten
  options. 1 file, net ≈ -10.

### 15. Two root-boundary checks

- `isWithinBoundary` (`src/core/path.ts:411-426`, "single source of
  truth") vs `partitionRootsWithin` (`:59-102`) differ on missing and
  EACCES targets.
- Move: `isWithinBoundary` delegates to `partitionRootsWithin`. 1 file,
  net ≈ -7. Behaviour change; pin with a test first.
  Constraint (T-02): keep the empty-boundary early return.

## Decision to reopen (out of scope for this map)

- `ignoreCeiling` computed per caller at `search.ts:373,541`, `list.ts:81`,
  `replace-text.ts:501`; ADR-001's 2026-09-28 amendment blesses it.
  `write-adr` hand-off.

## Below the bar (ponytail pass, not this map)

`Problem.toText`, `isLevelEnabled`, `ToolExecutor` `toolName`,
`ProgressSession` optionals, `FileType`/`Stats` re-exports,
`buildFileResourceLink`, read-mode decided twice in `tools/read.ts`,
`buildFileInfoResult`, 60 s TTL constant (net 0).

## Unverified, for bug-hunt

Windows segment normalisation order differs between
`src/core/path-utils.ts:106-111` and `src/core/sensitive.ts:215-236`; a
probe claims `CON .:x` passes the device check.
