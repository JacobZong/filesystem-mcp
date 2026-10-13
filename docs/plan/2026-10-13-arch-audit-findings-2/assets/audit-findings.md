# Architecture audit findings, 2026-10-13, at `4153e7e0` (sixth audit, post-PR #80)

Sixth audit. Eight zone probes (core-guard, core-io, tools-infra, tools-write,
tools-read, transport, top-level, tests) plus a full cross-zone import walk
(299 edges, no cycle, gradient clean), then an adversarial verify round: one
refuter per ranked candidate, every file access through this repo's own
filesystem-mcp tools. Every finding below survived its refuter; corrections
are folded in. The verify round refuted seven candidates on standing records
or merit (see the final sections) — do not re-hunt them.

Line numbers drift; re-grep before every edit.

## Findings, rank order

### 1. Two tools stat the disk past `GuardedFileSystem`

- `src/tools/search-text.ts:1` raw `import { stat } from 'node:fs/promises'`,
  used at `:188-189` — `validateExistingPath` then a bare, signal-less `stat`;
  the comment at `:187` justifies against `validateExistingDirectory`, not
  against `ctx.fs.stat`.
- `src/tools/move.ts:4` same raw import; `:121`
  `(await stat(realSource)).isDirectory()` gates the protected-entries
  security walk.
- `ctx.fs.stat` (`src/core/fs.ts:159`) is validate + abort-aware stat; eight
  other tool call sites already use it (`create.ts:319`, `edit.ts:391`,
  `patch.ts:145`, `read.ts:187`, `replace-text.ts:426,578`,
  `resources.ts:232`). `fs.ts:484-487` records this raw pair was folded once
  before (`statDetailed`).
- Legitimate raw stats, excluded: `cli.ts:56` (pre-guard), `path.ts:304,554`
  (the guard itself), `path-discovery.ts:33,103` (pre-roots).
- Move: swap both sites to `ctx.fs.stat(requested, { signal })`, delete the
  raw imports. 2 files, net ≈ -3..-4. Behavior-identical: error shapes land
  in the same catch at `move.ts:123`.

### 2. Page-cache identity rule spelled per tool

- Key = method + result-defining args, hand-picked at
  `src/tools/list.ts:243-248`, `src/tools/find-files.ts:85-92`,
  `src/tools/search-text.ts:223-234` (27 lines); `src/core/cursor.ts:76`
  takes it opaque; sole enforcement is the replay equality check at
  `src/core/store.ts:338`.
- Verifier cross-checked all three lists against their schemas: exact
  correspondence today, no live mismatch. The defect is the unenforced rule —
  a schema field added but forgotten in a key replays a stale snapshot
  silently.
- Move: `paginate` (or a `cursor.ts` helper) builds the key from method +
  args minus the per-tool paging fields (`['cursor','maxEntries']` for list;
  `['cursor','maxResults']` for find-files/search-text). Per-tool knowledge
  shrinks to a 2-name exclusion list; a misclassified field then fails loud as
  `INVALID_CURSOR` (pinned replay behavior at `outbound-regressions.test.ts:248-252`
  must keep working). 4 files, net ≈ -10..-15. Key byte-format change is safe:
  snapshots in-memory, ~60 s TTL, both ends through the same code.
- Behavior (T-01): valid queries unchanged; a forgotten field flips from
  silent stale replay to loud `INVALID_CURSOR`.

### 3. Pending-confirmation interpretation spelled per tool

- Derive sorted pending set, `confirmKey(pendingSorted.indexOf(item))`,
  read accepted choice, skip → skipped, else CANCELLED with
  `describeRefusal` — at `src/tools/create.ts:171-181`,
  `src/tools/move.ts:196-207`, `src/tools/delete.ts:238-250`; derivations at
  `create.ts:148`, `move.ts:359`, `delete.ts:316-318`.
- Primitives owned in `src/core/input-required.ts` (`:270,322,353,384`);
  the interpretation is not. The three blocks are token-identical in their
  shared core; `define.ts:319-356` is the boolean/multi-select grant flow, a
  different protocol — out of scope.
- Move: one verdict-returning helper (accepted | skipped | refused + refusal
  wording) in `input-required.ts`; callers keep their outcome mapping —
  delete returns a per-path failure (`delete.ts:243-250`), create/move throw.
  4 files, net ≈ -5..-10 (blocks total 36 lines; helper ≈ 15-19).

### 4. `PathGuard.isEntryAccessible` has one caller

- `src/core/path.ts:254`, 14-line docstring at `:240-253` selling it as the
  glob-walk entry filter; sole caller `src/tools/list.ts:103`; zero test
  callers. The other walk consumer, `src/core/search.ts:532`, hand-rolls
  validate-and-skip with deliberately different semantics (swallow-all +
  `skippedInaccessible`) — untouched by this move.
- Move: inline the body into `list.ts`; `path.ts` also sheds its
  `SKIPPABLE_FS_CODES`/`isSkippableErrno` imports. 2 files, net ≈ -15,
  behavior-identical.

### 5. Oversize refusal hand-rolled on the read path

- `createTooLargeError` (`src/core/read.ts:71`) owns the message;
  `errors.ts:245-250` auto-attaches the TOO_LARGE remedy to every `FsError`.
  Yet `read.ts:176-182` (tooLong), `:372-376` (readTailContent), `:436-442`
  (assertSizeWithinLimit) hand-roll messages whose in-message remedy tails
  double-state the auto-attached suggestion.
- Excluded, deliberate: `fs.ts:427` (`File too large for edit`, test-pinned
  label divergence); `define.ts:386-392`, `resources.ts:436,439`,
  `store.ts:178,196` oversize concepts (different limits/audiences).
- Move: owner gains an optional label interpolating its parenthetical (bare
  wording test-asserted at `tools.test.ts:2494,2512,2513` stays unchanged);
  the three sites route through it; `assertSizeWithinLimit` (sole caller
  `read.ts:455`) inlines away. 1 file, net ≈ -12.
- Behavior (T-01): in-message remedy tails drop from message text; the
  suggestion field keeps the remedy.

### 6. Core primitives duplicated or mishomed

- `CHAR_COLON = 58` declared twice (`src/core/path-utils.ts:80`,
  `src/core/sensitive.ts:13`); Win32 trailing-dots/spaces trim inline at
  `path-utils.ts:109` and re-declared as `trimTrailingDotsAndSpaces` at
  `sensitive.ts:236`; `sensitive.ts:4` header claims it "shares only"
  three primitives — false, `:10` imports a fourth (`parseTrueEnvFlag`).
- `parseTrueEnvFlag` (`path-utils.ts:49`) is env parsing living outside
  `util.ts:9,51` (`parseEnvInt`, `splitCsvList`); `toPosixRelative`
  (`src/core/path.ts:105`, the guard module) is a formatting helper imported
  by four tools; `path-utils.ts:4` declares itself the shared-primitives
  home.
- Move: export `CHAR_COLON` + the trim from `path-utils.ts`, import them in
  `sensitive.ts`, fix both headers; move `toPosixRelative` →
  `path-utils.ts` and `parseTrueEnvFlag` → `util.ts` (decide or record
  `splitDirList`, `path-utils.ts:59`); `warnInvalidSetting` stays
  (`path-utils.ts:30` — it makes the move cycle-free).
- 7 files including mechanical import updates (`cli.ts`, `path.ts`,
  `http.ts`, list/find-files/search-text/replace-text). Net ≈ -2 code-only,
  ≈ -8 collapsing the duplicated rationale comments. No test touches any
  of the four internals; contract snapshot covers the MCP surface only.

### 7. Out-of-root test fixture has no owner

- Spelled five ways: `__tests__/guards.test.ts:182`,
  `http-shared-guard.test.ts:36`, `subscriptions-listen.test.ts:350`,
  `path-guard-grant.test.ts:25` and `:395` (bypassing that file's own
  helper), `tools.test.ts:125,1356`. `helpers.ts` owns only the in-root
  twin (`createTestRoot`).
- Not absorbable by design (leave hand-rolled): `UNGRANTABLE_DIR`
  (`tools.test.ts:156` — must stay outside tmpdir to stay ungrantable);
  sibling-under-parent fixtures (`tools.test.ts:1549,2285,2342`,
  `core-fs.test.ts:990`); uncreated symlink targets (no fixture needed).
- Move: pure reuse — `createTestRoot` (already the outside factory at
  `glob.test.ts:318`, `stdio.test.ts:228`, `sandbox.test.ts:95`) plus
  `cleanupTestRoot`, for the 5 mkdtemp-dir sites and 2 tmpdir-file sites.
  No new helper code. 6-7 test files, net ≈ -10.

### 8. Subscribe-gate record drift

- `src/resources.ts:525-526` claims registration iff
  `resources.subscribe` is advertised — false on every modern instance
  (advertised at `server.ts:97`, deliberately unregistered; `server.ts:84-93`
  documents the true rule).
- ADR-003 `:93-94` records the gate as `era !== 'modern' && notifier ===
  undefined`; code runs `era !== 'modern' && !legacyHttp`
  (`resources.ts:528-529`). Divergent combo (era omitted + notifier present)
  exists in-repo at `tools.test.ts:1567`. Shipped transports always forward
  `era` — production unaffected.
- ADR-002's 2026-09-29 amendment blesses the predicate spelled twice — code
  unification excluded.
- Move: delete the false sentence (`:518-524` already state the true rule,
  net -2); append a dated `Amended 2026-10-13:` bullet to ADR-003 naming the
  full implemented gate. Text only, 2 files.

### 9. `readOnly` default spelled at three registrars

- `deps.readOnly ?? false` at `src/tools/index.ts:53`, `src/prompts.ts:18`,
  `src/resources.ts:492`; `server.ts:192` spreads only-when-true — a fourth
  spelling — and is the sole production caller of all three.
- Verifier confirmed every direct test caller passes an explicit boolean:
  zero test edits, behavior-preserving. The `ToolRegistrarDeps` optionality
  is one day old (fifth-audit finding 2) and never decided this question.
- Move: normalize once at the `server.ts` deps assembly; type the registrar
  deps field `boolean`; delete the three `?? false`. 4 files, line-neutral,
  default owners 4 → 1. `ServerOptions.readOnly?` (`path.ts:49`) stays
  optional — `createServer(options = {})` accepts empty options.

### 10. Thirteen stale record anchors

- `src/core/sensitive.ts:214` cites `getReservedDeviceName (path.ts)` — it
  lives at `path-utils.ts:108`.
- `src/transport/http-policy.ts:314` cites `parseAllowedHostsEnv`, which
  exists nowhere (zero hits repo-wide and in
  `node_modules/@modelcontextprotocol`), and claims an empty-value match with
  `resolveAllowedHosts` (`:151-152`) that is false — this doc misstates a
  CORS edge (all-blank origins = configured-empty, not unset).
- ADR-001: all seven anchors stale (`:10,40,43,44,70,76,93`; `:43` also
  names `DEFAULT_EXCLUDE_PATTERNS`, renamed to `DEFAULT_EXCLUDED_NAMES`).
- ADR-002: `:22` (stdio.ts:63 → seedRootsFromClient now `:87`), `:25`
  (resources.ts:490-553 → now `:518-581`), `:28` (define.ts:169-170 →
  now `:164-172`). `:89` still correct — leave.
- ADR-003: `:10` and `:79` cite `http.ts:334`, now the `setupExpressApp`
  call; the `legacy: 'stateless'` option is at `:316`.
- Move: re-anchor or swap line numbers for grep-able names, per the
  plans/039 maintenance recipe. 13 anchors, 5 files, net ~0.

### 11. Protocol revision hardcoded in two test files

- `'2026-07-28'` literals at `__tests__/http-server.test.ts:165`,
  `__tests__/input-required.test.ts:111,598` — all three build modern-era
  clients, so a revision bump silently turns each fixture into a stale-era
  client that still passes. `helpers.ts:556` declares the one-constant
  invariant; `cli.test.ts:136` shows the correct pattern in the identical
  raw-fetch position. `examples/clients/browser/server.ts:48` is standalone
  by design — out of scope.
- Move: re-export `MODERN_PROTOCOL_REVISION` from `helpers.ts` (both files
  already import helpers), use it at the three sites. 2 files, net +1;
  revision value drops from 4 code occurrences to its 1 owner.

## Refuted, do not re-hunt

- Written-file envelope fold (edit/patch/create/replace-text stat residue) —
  `docs/plan/2026-09-26-written-file-meta/written-file-meta.plan.md` created
  the owner (`buildWrittenFileMeta`) and rejected folding the post-write
  stat: per-file stat cost in replace-text sweeps; failure policies
  (create-append degrades, replace-text swallows, edit/patch throw) are
  deliberate; attach shapes are contract-snapshotted per tool.
- dryRun-lock-bypass fold — `docs/plan/2026-10-12-arch-audit-findings/assets/audit-findings.md:133-134`:
  nets +3..+5, makes replace-text's dry-run write runtime-guarded instead of
  lexically absent.
- stdio oversize remedies as one builder — same refuted list ("per-site
  remedies deliberate"); `oversizeRemedy` hook (`define.ts:136-138`) plus
  `outbound-regressions.test.ts:355-380` pins make the wording load-bearing.
- line-count unification — `countFileLines`' `GuardedFileSystem` home is
  record-blessed by the H4 fix (map T-01/T-03, `read-path-h4.run.md:7`);
  TC-FUNC-052a-e pin the byte-level rule; `read.ts:1` forbids the reverse
  import; the rule is re-derived per representation (`read.ts:339,357`).
- duplicate-entry refine hoist — plans/004 + 028; plan 028's maintenance
  note defers the `schema.ts` lift until a fourth whole-file batch-write
  tool exists. Move's runtime half was infeasible anyway (schema vs
  guard-resolved runtime split is load-bearing).
- test imports past the transport facade — unit tests must import
  unexported units; exporting `seedRootsFromClient` would put sunset-bound
  legacy machinery on the public API (ADR-002);
  `dist-smoke.test.ts:112` already asserts the public surface.
- DIFF "missing" from instructions — advertised on `tools/list` both modes
  (`contract.test.ts.snapshot:115-117,925-927`), README, `mcpb/manifest.json`;
  instructions is a curated navigation guide deferring inventory to
  tools/list; the index.ts comment reads restrictively.

## Decisions to reopen

- The five record-backed refutations above that carry real friction
  (written-file envelope, dryRun ternaries, oversize remedies, line-count
  spellings, duplicate-entry refines) reopen only via `write-adr` if their
  recorded triggers fire — fourth stat policy, replace-text dry-run write
  becoming runtime-guarded, remedies losing audience-specificity, a third
  counter representation, a fourth whole-file batch-write tool.

## Below the bar (ponytail pass, not this map)

Progress tick tuple naming (type-only, net 0); `DEFAULT_SEARCH_TIMEOUT_MS`
rename (net 0, 7 files); wire-limit formula restated in prose
(`cli-help.ts:49,88`, `http.ts:69`, `stdio.ts:268`); 60 s TTL constant (net 0,
  carried from the fifth audit); `STREAM_CHUNK_SIZE` export (2 lines);
`tools.test.ts` split (net 0); cli-help defaults restating (unverified this
pass); hand-built JSON-RPC response test in `stdio.ts:252` (net-0 swap for
`isJSONRPCResponse`).

## Coverage

Zones: 8 probed, every cross-zone edge walked. `__tests__` sampled by
vocabulary, not read exhaustively. Untracked `exampels/` typo dir: local
leftover, not repo content. All audit file access through the repo's own
filesystem-mcp tools; git churn via shell (the server ships no git tool).
