# Architecture audit findings — 2026-10-12, at `cf6383cd`

Fourth audit. Six zone probes; 15 candidates raised, each adversarially priced
against the four gates (net deletion, seam varies twice, churn, record); 9
survived, 6 refuted. No ADR drift survives: ADR-001 exclusion ownership is
clean end-to-end, all five `sunset(SEP-2577)` sites are intact, and the
registrar boundary holds.

Line numbers drift; re-grep before every edit.

## Findings, rank order

### 1. Store cap diverges from the outbound-byte owner

- `src/core/store.ts:100` pins `MAX_ENTRY_BYTES = 10 * MIB` — no envelope
  headroom, no comment tying it to the SDK's fixed 10 MiB stdio `ReadBuffer`.
  `src/core/util.ts:147` owns the same constraint as
  `MAX_OUTBOUND_RESULT_BYTES = 10 * MIB - 256 * KIB`; `tools/read.ts:435` and
  `tools/define.ts:92` already treat it as stdio-only. `resources.ts:373`
  serves stored text verbatim, so an externalized result cached near the cap
  and read back over `resources/read` on stdio overflows the buffer the util
  constant exists to protect.
- Move: `store.ts` imports `MAX_OUTBOUND_RESULT_BYTES` and deletes its
  literal. 1 file, net deletion.
- Behaviour at the margin: near-cap entries refuse as too-large-to-cache
  instead of caching and overflowing. Store tests mock the store; unaffected.

### 2. `high-severity-fixes.test.ts` pools six concerns

- `__tests__/high-severity-fixes.test.ts` (423 lines, describes at 45, 118,
  179, 213, 274, 327) pins six unrelated seams from one changelog batch:
  H2 edit/create write serialization, H3 move overlap, H1 edit dense-match,
  H1+H6 search interruptibility, H5 stdio read buffer, H4 symlink TOCTOU.
  The outer `before()` boots a second server used only for `ctx.pathGuard`.
  Destination homes already exist: `tools.test.ts:731-878` (edit ambiguity),
  `:3045-3083` (direct `searchContent`), `:1173-1250` (read budget);
  `core-fs.test.ts:291-403` (guarded symlink appends), `:637-700`;
  `stdio.test.ts` (subprocess reads).
- Move: dissolve — H1/H2/H3/H6 describes into `tools.test.ts`, H4 into
  `core-fs.test.ts`, H5 into `stdio.test.ts`; delete the file.
  4 files, net ≈ -55. H1-H6 stay greppable in test titles.

### 3. Modern-era client stamp re-declared five times

- The modern-era client stamp (`protocolVersion` + `clientCapabilities` +
  `clientInfo`) is hand-built at `__tests__/stdio.test.ts:28-32` and
  `:267-271`, `__tests__/input-required.test.ts:549-553`,
  `__tests__/cli.test.ts:145-149`, and one http-test site — 5 stamps in 4
  files, the era literal spelled 7 ways. `cli.test.ts:120` pins the
  constant. ADR-002 schedules an era migration; today it touches 7 spellings.
- Move: `helpers.ts` gains `modernClientMeta(name, capabilities = {})`
  deriving `protocolVersion` from `MODERN_PROTOCOL_REVISION`
  (`src/core/config.ts:47`) — derivation, not a new literal, so cli.test's
  pin-the-constant role survives. Five sites spread or override
  capabilities. 6 files, net ≈ -8.

### 4. Resource contracts spelled twice

- `src/resources.ts:455-459` hand-builds `[createInstructionsResource,
  createResultResource, file]`; the exported `getResourceContracts`
  (`:383-389`) builds the identical triple, consumed only by
  `__tests__/resources.test.ts`. A fourth contract added to one list
  silently misses the other, and tests exercise only the export.
- Move: `registerResources` calls `getResourceContracts(options)` and
  locates the file contract (cast needed — plain `ResourceContract` makes
  `file.subscribe` possibly-undefined). 1 file, net ≈ -4. Tests unchanged.

### 5. Failed-notify rule spelled three times

- "A failed notify means the connection went away; void-send, catch,
  `Logger.debug`" is spelled at `src/transport/stdio.ts:173-181`,
  `src/resources.ts:510-518`, `src/server.ts:159-170` — three sites, one per
  send method, wording already one-word drifted.
- Move: one `voidSend(send, label, fields)` helper in
  `src/core/observability.ts` (not `server.ts` — it would cycle with
  `resources.ts`); three call sites shrink. 4 files, net ≈ -7.

### 6. `guardedEntries` one-caller generator

- `src/core/search.ts:486-514` is a ~28-line private async generator whose
  sole caller is `searchFiles` (`:557`). Its body (abort-mark,
  inaccessible-count, walk-throw) inlines verbatim into `searchFiles`'
  existing `for await` loop; nothing reappears. The second caller was
  removed by plans/045.
- Move: inline into the loop; delete the generator and its doc block.
  1 file, net ≈ -6.

### 7. `replace_text` re-rolls a TOO_LARGE error an owner exports

- `src/tools/replace-text.ts:333-337` hand-rolls
  `` `File too large: ${validPath} (${stats.size} bytes > ${maxFileSize} bytes)` ``
  while `src/core/read.ts:94` exports `createTooLargeError` for this exact
  condition and `fs.ts:434-436` is the identical stat-pre-check precedent —
  with a tool label and advice, which this variant carries neither. No test
  pins the old message.
- Move: call `createTooLargeError(stats.size, maxFileSize, validPath)` —
  signature is `(bytesRead, maxSize, requestedPath)` — widening the existing
  `read.ts` import at `replace-text.ts:17`. Keep the stat pre-check.
  1 file, net ≈ -3. User-visible message wording changes once.

### 8. `list.ts` re-wraps a deadline `ctx.signal` already carries

- `src/tools/list.ts:257` passes
  `AbortSignal.any([ctx.signal, AbortSignal.timeout(DEFAULT_SEARCH_TIMEOUT_MS)])`
  to `collect()`. `define.ts:238-240` already chains the identical 5 s
  deadline into `ctx.signal` (list declares `timeoutMs` at `:311`), starting
  strictly earlier on every path; the second timer can never fire first.
  Inlining accident from `d7ccfaef`.
- Move: `signal: ctx.signal`. 1 file, net 0 lines; deletes the dead
  expression plus two allocations per cold call.

### 9. `readLeadingSample` never-varying size knob

- `src/core/fs.ts:350` takes a `size` parameter with exactly one caller
  (`tools/create.ts:284`) always passing `MIME_SAMPLE_SIZE`; no test ever
  passes another value, and `detectMimeFromContent` clamps to the same
  constant (`mime.ts:212-214`).
- Move: drop the parameter, use `MIME_SAMPLE_SIZE` inside `fs.ts`; the
  caller's argument goes. 2 files, net ≈ -2.

## Refuted, do not re-hunt

- Finding 1 (store cap vs the outbound owner), refuted at delivery on
  2026-10-13. Stdio already builds its store with
  `{ maxReadResultBytes: MAX_OUTBOUND_RESULT_BYTES }` (`src/server.ts:178`),
  and `putText` measures the JSON-encoded read-back against it, so a
  near-cap entry was already refused on stdio. The move only swapped the
  refusal message there, and it would have narrowed HTTP's cap.
- `search.ts` `maxResults ?? 100` — live default for 11 test call sites;
  a required-param move nets +11.
- `lockForWrite` `resolvedTarget` param — net 0; probing the lock-resolved
  path is the TOCTOU posture.
- Dry-run lock-bypass fold — nets +3..+5 and makes replace-text's dry-run
  write runtime-guarded instead of lexically absent.
- Dead `notifier` branch — live: `tools.test.ts:1550` builds notifier with
  era undefined, a sanctioned state per `server.ts:64`.
- Inbound-formula prose ×4 — only 2 of 4 sites share the derivation
  wording; a single template nets +2/+3.
- ADR-002 marker gap at `instructions.ts:67` — adjudicated 2026-09-29; the
  five-site grep is the recorded shape and the Consequences list owns the
  descriptive-text sites.
- `resourceUpdateSink` wrapper — guards `this` on an interface method.
- Watcher-failure vocabulary — net 0.
- TOO_LARGE as ownerless — owned enum; per-site remedies deliberate.
- `stoppedEarlyLine` `maxFiles` gap — deliberate, commented at
  `replace-text.ts:642-648`.
- Overwrite-confirm fold — needs three config knobs; net addition.
- Binary-detection fold — policies deliberately differ per their comments.