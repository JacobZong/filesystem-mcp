# Plan 074: `read` returns other binary files as an embedded resource when asked

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. The reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 83103bd..HEAD -- src/tools/read.ts src/core/read.ts src/core/fs.ts src/core/mime.ts`
> If that prints anything, compare the "Current state" excerpts against the
> live code. On a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M (eight small steps)
- **Risk**: LOW–MED. The new path only runs when a caller passes
  `binary: true`. Two behaviours change for everyone: the binary refusal text
  gains a hint, and a batch counts image and audio files at their base64 size.
- **Depends on**: none
- **Category**: feature
- **Issue**: [#98](https://github.com/j0hanz/filesystem-mcp/issues/98)
- **Planned at**: commit `83103bd`, 2026-10-15
- **Dry run**: every step's code and test below was applied to `83103bd` in a
  scratch worktree. `npm run check` was green: 816 tests, 0 failures, lint,
  Prettier and knip clean. The snapshot diff was exactly the step-7 list.

## Why this matters

`read` returns images and audio as media blocks and refuses every other
binary file. Reproduced at `83103bd` through the in-memory client:

```text
read {path: <ws>/doc.pdf}          -> isError, "Binary file detected."
read {path: <ws>/a.zip}            -> isError, "Binary file detected."
read {path: <ws>/notes.bin}        -> isError, "Binary file detected."   (ASCII content)
read {paths: [a.txt, doc.pdf]}     -> a.txt read; doc.pdf "// Error: Binary file detected."
```

A client that can use the bytes (a PDF-capable model, or a client built from
the README's "Build your own client" section) has no way to get them from a
tool call. The reference filesystem server's `read_media_file` returns any
non-media file as an MCP embedded resource:
`{ type: 'resource', resource: { uri, mimeType, blob } }`. `resources/read`
on this server already returns binary files as `blob` (`src/resources.ts`),
so the bytes are reachable today only through a second protocol call that
many clients do not expose to the model.

## Decisions

These are settled. Do not revisit them during execution.

1. **Opt-in flag `binary: true`, default `false`.** A 10 MiB file is about
   13.3 MiB of base64. A model that did not ask for it should not spend its
   context on it. Without the flag, behaviour stays the same except for the
   refusal text, which now names the flag.
2. **`binary: true` means "return as a resource what a plain read refuses as
   binary".** The read tries the text path first. Only the text path's own
   `Binary file detected.` refusal falls through to the raw read. So the
   denylist, root checks, the UTF-16 refusal (plan 029), NOT_FILE and
   TOO_LARGE all behave as they do today, with or without the flag. No second
   binary verdict is introduced. This matters because `readRaw`'s verdict
   (`detectMimeFromContent`) and the text path's verdict (`assertNotBinary`:
   extension list, then content probe) disagree on a `.bin` file with ASCII
   content. A text-first fallback cannot loop on that file.
3. **Images and audio are unchanged.** They still return media blocks, with or
   without the flag, before the text path runs.
4. **Block shape.** The block is
   `{ type: 'resource', resource: { uri: filesystem-mcp://file/…, mimeType, blob } }`.
   This matches the reference server and SDK 2.3.1's `EmbeddedResourceSchema`.
   Metadata goes where every `read` already puts it,
   `_meta.results[i].value`, which `buildSuccessResponse`
   (`src/tools/define.ts:202`) fills from the structured half. That value
   gains `size` (bytes). It keeps `kind`, `mimeType`, `resourceUri` and
   `modified`. The block itself gets no `_meta` and no `annotations`. No
   `resource_link` is emitted for a binary file, as for media.
5. **Range reads stay refused.** `binary: true` together with `head`, `tail`,
   `startLine` or `endLine` fails input validation in `read`'s own
   `superRefine`. A schema-level `oneOf` would undo the Unreleased "no
   top-level `oneOf`" change. A range read of a binary file without the flag
   gets a refusal that says to read it whole with `binary: true`.
6. **Size cap unchanged.** `readRaw` already refuses over `getMaxTextFileSize()`
   (`--max-file-size`). Over stdio, the existing whole-response guard
   (`refuseOversized`, `src/tools/define.ts:405`) refuses a base64 result past
   `MAX_OUTBOUND_RESULT_BYTES`, roughly a 7.3 MiB file. Its remedy for a
   `resource` block says to connect over HTTP and does not suggest
   `head`/`tail`.
7. **The batch budget charges base64 size** for every file whose bytes return
   as base64: image and audio files always, and known-binary extensions when
   `binary: true`. The budget (plan 022) limits what the model receives, and
   a 400 KiB zip ships as 533 KiB. Files with an unknown extension are still
   charged their raw size. This under-counts by up to 4/3, which is
   acceptable for an estimate.

## Current state

- `src/tools/read.ts:50-63`: `ReadFileInputSchema` is
  `singleOrBatchPathsInput({ includeHash, ...readRangeFields })` with a
  `superRefine` that calls `validateReadRange`.
- `src/tools/read.ts:72-87`: `ReadPerPathValue` has no `size`.
  `:143-146` `PerPathReadValue` adds `content` and `mediaData`.
- `src/tools/read.ts:158-205`: `collectFileBudget(filePaths, maxTotalSize, maxSize, ctx)`
  charges `Math.min(out.stats.size, maxSize)` per file.
- `src/tools/read.ts:260-304` `readOnePath` (abridged):

  ```ts
  // ... svg carries kind:'image' but is XML text —
  // readRaw.isBinary is false for it, so it falls through to the text path.
  const isRangeRead = args.head !== undefined || /* tail, startLine, endLine */;
  if (!isRangeRead) {
    const mime = detectMimeType(filePath);
    if (mime.kind === 'image' || mime.kind === 'audio') {
      const raw = await ctx.fs.readRaw(filePath, { signal: ctx.signal });
      if (raw.isBinary) {
        return {
          content: `[binary ${mime.kind} content: ${String(raw.content.length)} bytes; returned as a ${mime.kind} content block]`,
          mimeType: raw.mimeType,
          kind: mime.kind,
          mediaData: raw.content.toString('base64'),
        };
      }
    }
  }
  const spec = buildReadSpec(args, ctx.signal);
  const result = await ctx.fs.readFile(filePath, spec);
  return buildPerPathReadValue(result, { includeHash: args.includeHash, requestedPath: filePath });
  ```

  The svg comment is wrong. `detectMimeFromContent` returns EXT_MAP's
  `{ image/svg+xml, kind: 'image' }`, so `readRaw.isBinary` is `true`, and an
  svg comes back as an `image` block (reproduced). Step 4 fixes the comment
  only.

- `src/tools/read.ts:306-311` description:
  `'Read text files, like cat: whole, or one slice via head, tail, or startLine/endLine. ' + 'Images and audio return as media; other binary files are rejected.'`
- `src/tools/read.ts:349-377`: the content-block loop pushes media blocks and
  `continue`s. Otherwise it pushes a `resource_link` when `v.resourceUri && v.content`.
- `src/tools/read.ts:380-399`: an error entry renders as `error.message`
  only. **`suggestion` never reaches the text block**, so the flag hint
  must go in the message itself.
- `src/tools/read.ts:407-411`: `structuredResults` strips `content` and
  `mediaData`.
- `src/tools/read.ts:420-424`:

  ```ts
  oversizeRemedy: (result) =>
    result.resources?.some((b) => b.type === 'image' || b.type === 'audio')
      ? 'This media file is too large to return over the stdio transport; connect over HTTP, or raise it as a smaller file.'
      : 'Read a slice with head, tail, or startLine/endLine.',
  ```

- `src/core/read.ts:418-442` `assertNotBinary` throws
  `new FsError(ErrorCode.INVALID_INPUT, 'Binary file detected.', filePath)` at
  `:426` (known-binary extension) and `:440` (probe). The UTF-16 refusal
  between them has a different message.
- `src/core/fs.ts:484-516` `readRaw(filePath, options)` returns
  `{ content: Buffer; mimeType: string; isBinary: boolean }`. It validates via
  `pathGuard.validateExistingPath` (denylist included), refuses
  `stats.size > getMaxTextFileSize()` with TOO_LARGE, and sets
  `isBinary: mimeInfo.kind !== 'text'`. Other callers: `src/resources.ts:236`
  and tests that only destructure `content`, so added fields are safe.
- `src/core/mime.ts`: `FileKind = 'text' | 'binary' | 'image' | 'audio' | 'pdf'`.
  `pdf` → `application/pdf`/`pdf`, `zip` → `application/zip`/`binary`.
  `isKnownBinaryExtension` covers EXT_MAP non-text kinds (svg excluded) plus
  `EXTRA_BINARY_EXTENSIONS` (`bin`, `sqlite`, `woff2`, `docx`, …).
- Tests: `__tests__/tools.test.ts:113` (TC-FUNC-002, image block) and
  `:1098` (UTF-16 refusal in every mode) are the patterns to copy. Helpers:
  `harness`, `tmpDir`, `firstTextBlock`, `failedSummary`, `withEnv`,
  `writeTestFile`. `__tests__/outbound-regressions.test.ts:52` defines
  `binaryFile` (`resource.bin`, 8 MiB of zeros) on a real stdio server, and
  `:388` is the media-remedy test to copy.
- User-facing text that says binary is refused: `README.md:264`,
  `docs/client-guide.md:319-321`, `docs/configuration.md:211-212`, and
  the contract snapshot (`__tests__/contract.test.ts.snapshot:434` and
  `:984`). `mcpb/manifest.json:42` does not mention binary, so leave it.

## Commands you will need

The repo needs Node ≥ 24. If `node --version` prints less, prefix every
command with `npx -y -p node@24 --` (for example
`npx -y -p node@24 -- npm test`).

| Purpose         | Command                                                                                  | Expected on success |
| --------------- | ---------------------------------------------------------------------------------------- | ------------------- |
| Install         | `npm ci`                                                                                 | exit 0              |
| Static          | `npm run check:static`                                                                   | exit 0              |
| Read tests      | `node --test --test-timeout=60000 --test-name-pattern="binary" __tests__/tools.test.ts`  | all pass            |
| Core fs tests   | `node --test --test-timeout=60000 __tests__/core-fs.test.ts`                             | all pass            |
| Stdio tests     | `node --test --test-timeout=60000 __tests__/outbound-regressions.test.ts`                | all pass            |
| Snapshot update | `env -u FS_MAX_FILE_SIZE node --test --test-update-snapshots __tests__/contract.test.ts` | exit 0              |
| Format          | `npx prettier --write <files you touched>`                                               | exit 0              |
| Full check      | `npm run check`                                                                          | exit 0              |

## Scope

**In scope**: `src/core/read.ts`, `src/core/fs.ts`, `src/tools/read.ts`,
`__tests__/tools.test.ts`, `__tests__/outbound-regressions.test.ts`,
`__tests__/contract.test.ts.snapshot`, `README.md`, `docs/client-guide.md`,
`docs/configuration.md`, `CHANGELOG.md`.

**Out of scope**: `src/core/mime.ts` (MIME map, svg kind),
`src/resources.ts`, every other tool, `mcpb/`, `server.json`,
`package.json` versions, `plans/`.

## Git workflow

- Work on the branch the dispatcher names. Run the drift check against
  `83103bd` first.
- One commit per step, with the message given in that step. End each message
  with the trailer the dispatcher gives you. Do not push unless the dispatcher
  says so.

## Execution model: one small Haiku agent per step

Each step is sized for one Haiku 5.5 agent (`model: haiku`) and uses the
same template: **Files**, **Change**, **Test**, **Verify**, **Commit**. The
dispatcher sends each agent this plan's path, its step number, and the
branch. One step, one agent, one commit. The dispatcher reads the diff and
the Verify output before sending the next step. An agent that hits a STOP
condition reports it and makes no commit. Before each commit, run Prettier
on the files the step touched; the pasted snippets are not pre-formatted.
Every commit must also pass `npm run check:static` (build, lint, Prettier,
knip), so a step never adds an export that only a later step uses.

Order: 1 → 2 → 3 → 4 → 5 → 6, then 7 and 8 in parallel, then 9.
Steps 2–6 all edit `src/tools/read.ts`, so they must not run concurrently.

## Steps

### Step 1: `readRaw` reports path, kind and mtime (no behaviour change)

**Files**: `src/core/fs.ts`.

**Change**: in `src/core/fs.ts` `readRaw`, widen the return type to
`{ content: Buffer; mimeType: string; kind: FileKind; isBinary: boolean; validPath: string; modified: string }`.
Return `kind: mimeInfo.kind`, `validPath` and
`modified: stats.mtime.toISOString()` as well. Import `type FileKind` from
`./mime.ts` if it is not imported already.

The binary-refusal exports land in step 3, next to their first caller: knip
fails `check:static` on an export nothing imports, so every step adds an
export together with its first use.

**Test**: none new. The fields are additive.

**Verify**: `npm run check:static` → exit 0. The core fs tests → all pass.

**Commit**: `refactor(fs): readRaw also returns the real path, kind and mtime`

### Step 2: The `binary` input field

**Files**: `src/tools/read.ts`, `__tests__/tools.test.ts`.

**Test first**: add next to TC-FUNC-002:

```ts
it('read refuses binary together with a line range', async () => {
  const file = await writeTestFile(tmpDir, 'binary-flag/range.txt', 'a\nb\n');
  for (const extra of [{ head: 1 }, { tail: 1 }, { startLine: 1 }, { startLine: 1, endLine: 2 }]) {
    const result = await harness.client.callTool({
      name: 'read',
      arguments: { path: file, binary: true, ...extra },
    });
    assert.strictEqual(result.isError, true, JSON.stringify(extra));
    assert.match(firstTextBlock(result).text ?? '', /Cannot use 'binary'/);
  }
});
```

Run it. It must fail: the input schema is strict, so today `binary` is
refused as an unrecognized key, not with this message. If it passes, STOP.

**Change**: in `ReadFileInputSchema`, add after `includeHash`:

```ts
binary: defaultFalseBoolean(
  'Return a binary file that is not an image or audio whole, as a base64 embedded resource. Full reads only.',
),
```

In its `superRefine`, after `validateReadRange(...)`:

```ts
const hasRange =
  value.head !== undefined ||
  value.tail !== undefined ||
  value.startLine !== undefined ||
  value.endLine !== undefined;
if (value.binary && hasRange) {
  ctx.addIssue({
    code: 'custom',
    path: ['binary'],
    message:
      "Cannot use 'binary' with 'head'/'tail'/'startLine'/'endLine'. A binary file is read whole.",
    input: value,
  });
}
```

**Verify**: the read tests → the new test passes. `npm run check:static` →
exit 0. The contract test now fails on the schema. That is expected and is
fixed in step 7.

**Commit**: `feat(read): add the binary input, refused with a line range`

### Step 3: The refusal names the flag

**Files**: `src/core/read.ts`, `src/tools/read.ts`, `__tests__/tools.test.ts`.

**Test first**:

```ts
it('read without binary refuses a binary file and names the flag', async () => {
  const dir = join(tmpDir, 'binary-flag');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'hint.zip');
  await writeFile(file, Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0]));
  const whole = await harness.client.callTool({ name: 'read', arguments: { path: file } });
  assert.strictEqual(whole.isError, true);
  assert.strictEqual(failedSummary(whole)?.results?.[0]?.error?.code, 'INVALID_INPUT');
  assert.match(firstTextBlock(whole).text ?? '', /^Binary file detected\. Pass binary: true/);

  const ranged = await harness.client.callTool({
    name: 'read',
    arguments: { path: file, head: 1 },
  });
  assert.strictEqual(ranged.isError, true);
  assert.match(firstTextBlock(ranged).text ?? '', /no lines; read it whole with binary: true/);
});
```

It must fail on the first `match`. If it passes, STOP.

**Change**:

1. In `src/core/read.ts`, above `assertNotBinary`, add:

   ```ts
   /** The text path's binary refusal; `read` matches it to offer `binary: true`. */
   export const BINARY_FILE_MESSAGE = 'Binary file detected.';

   export function isBinaryRefusal(error: unknown): error is FsError {
     return (
       error instanceof FsError &&
       error.code === ErrorCode.INVALID_INPUT &&
       error.message === BINARY_FILE_MESSAGE
     );
   }
   ```

   Use `BINARY_FILE_MESSAGE` in both `throw`s inside `assertNotBinary`
   (`:426`, `:440`). Leave the UTF-16 throw and the strict-UTF-8
   `'Binary or non-UTF-8 file detected.'` throw unchanged.

2. In `src/tools/read.ts` `readOnePath`, wrap the `ctx.fs.readFile` call:

   ```ts
   let result: ReadFileResult;
   try {
     result = await ctx.fs.readFile(filePath, spec);
   } catch (error: unknown) {
     if (!isBinaryRefusal(error)) throw error;
     throw new FsError(
       ErrorCode.INVALID_INPUT,
       isRangeRead
         ? `${BINARY_FILE_MESSAGE} It has no lines; read it whole with binary: true to get it as a base64 embedded resource.`
         : `${BINARY_FILE_MESSAGE} Pass binary: true to get it as a base64 embedded resource.`,
       filePath,
       error,
     );
   }
   ```

   Import `BINARY_FILE_MESSAGE` and `isBinaryRefusal` from `../core/read.ts`.
   `ReadFileResult` is already imported as a type.

**Verify**: the read tests → pass. Then
`npm test -- --test-name-pattern="Binary|binary"` → all pass. If an existing
test asserted the exact old text through the `read` tool, STOP. Core-level
tests (`core-fs.test.ts:351`, `:374`) keep the bare message and must still
pass.

**Commit**: `feat(read): the binary refusal says to pass binary: true`

### Step 4: Return the embedded resource

**Files**: `src/tools/read.ts`, `__tests__/tools.test.ts`.

**Test first**: add these tests. Each must fail before the change.

```ts
it('read with binary returns a PDF or zip as an embedded resource', async () => {
  const dir = join(tmpDir, 'binary-flag');
  await mkdir(dir, { recursive: true });
  const cases = [
    {
      name: 'doc.pdf',
      bytes: Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1'),
      mimeType: 'application/pdf',
      kind: 'pdf',
    },
    {
      name: 'a.zip',
      bytes: Buffer.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0]),
      mimeType: 'application/zip',
      kind: 'binary',
    },
    // Refused by extension although its bytes are ASCII: still one resource.
    {
      name: 'notes.bin',
      bytes: Buffer.from('plain ascii\n'),
      mimeType: 'application/octet-stream',
      kind: 'binary',
    },
  ];
  for (const c of cases) {
    const file = join(dir, c.name);
    await writeFile(file, c.bytes);
    const result = await harness.client.callTool({
      name: 'read',
      arguments: { path: file, binary: true, includeHash: true },
    });
    assert.notStrictEqual(result.isError, true, c.name);
    const blocks = result.content as readonly {
      type: string;
      resource?: { uri?: string; mimeType?: string; blob?: string };
    }[];
    assert.strictEqual(blocks.filter((b) => b.type === 'resource_link').length, 0, c.name);
    const block = blocks.find((b) => b.type === 'resource');
    assert.ok(block?.resource, `${c.name}: expected an embedded resource`);
    assert.strictEqual(block.resource.uri, buildFileResourceUri(file));
    assert.strictEqual(block.resource.mimeType, c.mimeType);
    assert.ok(Buffer.from(block.resource.blob ?? '', 'base64').equals(c.bytes), c.name);
    assert.match(firstTextBlock(result).text ?? '', /returned as an embedded resource block/);
    assert.match(firstTextBlock(result).text ?? '', /\/\/ sha256: [0-9a-f]{64}/);
    const value = (result._meta as { results?: { value?: Record<string, unknown> }[] }).results?.[0]
      ?.value;
    assert.strictEqual(value?.['kind'], c.kind);
    assert.strictEqual(value?.['mimeType'], c.mimeType);
    assert.strictEqual(value?.['size'], c.bytes.length);
    assert.strictEqual(value?.['resourceUri'], buildFileResourceUri(file));
    assert.strictEqual(value?.['blobData'], undefined, 'bytes never ride _meta');
  }
});

it('read with binary leaves text, UTF-16, secret and oversize files as they were', async () => {
  const text = await writeTestFile(tmpDir, 'binary-flag/plain.txt', 'hello\n');
  const plain = await harness.client.callTool({
    name: 'read',
    arguments: { path: text, binary: true },
  });
  assert.notStrictEqual(plain.isError, true);
  assert.strictEqual(firstTextBlock(plain).text, 'hello\n');
  assert.ok((plain.content as { type: string }[]).some((b) => b.type === 'resource_link'));

  const utf16 = join(tmpDir, 'binary-flag/utf16.txt');
  await writeFile(
    utf16,
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi\n', 'utf16le')]),
  );
  const wide = await harness.client.callTool({
    name: 'read',
    arguments: { path: utf16, binary: true },
  });
  assert.strictEqual(wide.isError, true);
  assert.match(failedSummary(wide)?.results?.[0]?.error?.message ?? '', /UTF-16/);

  const secret = await writeTestFile(tmpDir, 'binary-flag/.env', 'SECRET=1');
  const denied = await harness.client.callTool({
    name: 'read',
    arguments: { path: secret, binary: true },
  });
  assert.strictEqual(denied.isError, true);
  assert.ok(!(denied.content as { type: string }[]).some((b) => b.type === 'resource'));

  const big = join(tmpDir, 'binary-flag/big.zip');
  await writeFile(big, Buffer.alloc(1024 * 1024 + 1));
  await withEnv({ FS_MAX_FILE_SIZE: String(1024 * 1024) }, async () => {
    const tooLarge = await harness.client.callTool({
      name: 'read',
      arguments: { path: big, binary: true },
    });
    assert.strictEqual(tooLarge.isError, true);
    assert.strictEqual(failedSummary(tooLarge)?.results?.[0]?.error?.code, 'TOO_LARGE');
  });
});
```

`buildFileResourceUri`, `mkdir` and `withEnv` are already imported in
`tools.test.ts`. The new files live under `binary-flag/` so they do not
disturb tests that look at `tmpDir` itself. The first test must fail before
the change; if it passes, STOP. The second test is a guard: parts of it pass
already, and all of it must pass after the change.

**Change** in `src/tools/read.ts`:

1. `ReadPerPathValue`: add
   `/** Bytes in the file; set when the bytes ride a media or resource block. */ size?: number;`
2. `PerPathReadValue`: add `blobData?: string;` next to `mediaData`, and say
   so in its JSDoc.
3. Add above `readOnePath`:

   ```ts
   /**
    * `binary: true` after the text path refused the file as binary. readRaw
    * re-validates the path (roots, denylist) and enforces the same size cap.
    * A file refused by its extension can still probe as text: it ships as the
    * extension says, octet-stream.
    */
   async function readBinaryResource(
     filePath: string,
     args: ReadFileInput,
     ctx: ToolCtx,
   ): Promise<PerPathReadValue> {
     const raw = await ctx.fs.readRaw(filePath, { signal: ctx.signal });
     const asText = raw.kind === 'text';
     const kind: FileKind = asText ? 'binary' : raw.kind;
     const mimeType = asText ? 'application/octet-stream' : raw.mimeType;
     const size = raw.content.length;
     return {
       content: `[binary ${kind} content: ${String(size)} bytes (${mimeType}); returned as an embedded resource block]`,
       mimeType,
       kind,
       size,
       resourceUri: buildFileResourceUri(raw.validPath),
       modified: raw.modified,
       blobData: raw.content.toString('base64'),
       ...(args.includeHash
         ? { contentHash: createHash('sha256').update(raw.content).digest('hex') }
         : {}),
     };
   }
   ```

4. In the step-3 `catch`, before the `throw new FsError(...)`, add:

   ```ts
   // The schema refuses binary with a range, so this is always a full read.
   if (args.binary) return await readBinaryResource(filePath, args, ctx);
   ```

5. In the media branch, add `size: raw.content.length` to the returned value.
   Replace the two svg sentences of the comment above `isRangeRead` with:
   `svg is kind 'image' in EXT_MAP, so readRaw reports it binary and it returns as an image block.`
6. In `run`'s content loop, before the media check:

   ```ts
   if (v.blobData !== undefined && v.resourceUri !== undefined && v.mimeType !== undefined) {
     resources.push({
       type: 'resource',
       resource: { uri: v.resourceUri, mimeType: v.mimeType, blob: v.blobData },
     });
     continue;
   }
   ```

7. In `structuredResults`, also strip `blobData: _blobData`.

**Verify**: the read tests → all pass. Then `npm run check:static` → exit 0.

**Commit**: `feat(read): binary: true returns other binary files as an embedded resource`

### Step 5: Batch reads and the base64 budget

**Files**: `src/tools/read.ts`, `__tests__/tools.test.ts`.

**Test first**:

```ts
it('batch read with binary mixes text and resources and charges base64 size', async () => {
  const text = await writeTestFile(tmpDir, 'binary-flag/mix/a.txt', 'x'.repeat(100 * 1024));
  const pdf = join(tmpDir, 'binary-flag/mix/doc.pdf');
  await writeFile(pdf, Buffer.from('%PDF-1.4\n', 'latin1'));
  const mixed = await harness.client.callTool({
    name: 'read',
    arguments: { paths: [text, pdf], binary: true },
  });
  assert.notStrictEqual(mixed.isError, true);
  const types = (mixed.content as { type: string }[]).map((b) => b.type);
  assert.deepStrictEqual(types, ['text', 'resource_link', 'resource']);
  assert.strictEqual(failedSummary(mixed)?.summary?.failed, 0);

  // 100 KiB + 400 KiB fits 512 KiB raw, but the zip ships as ~533 KiB of base64.
  const zip = join(tmpDir, 'binary-flag/mix/big.zip');
  await writeFile(zip, Buffer.alloc(400 * 1024));
  const budget = await harness.client.callTool({
    name: 'read',
    arguments: { paths: [text, zip], binary: true },
  });
  const results = failedSummary(budget)?.results;
  assert.strictEqual(results?.[0]?.error, undefined);
  assert.strictEqual(results?.[1]?.error?.code, 'TOO_LARGE');
  assert.match(results?.[1]?.error?.message ?? '', /maxTotalSize/);
});
```

It must fail on the budget assertion. The zip is read today, because the
budget charges raw bytes. If it passes, STOP.

**Change**:

1. Add above `collectFileBudget`:

   ```ts
   /** What a file costs the batch: one whose bytes ship as base64 costs that size. */
   function budgetBytes(path: string, size: number, binary: boolean): number {
     const { kind } = detectMimeType(path);
     const base64 =
       kind === 'image' || kind === 'audio' || (binary && isKnownBinaryExtension(path));
     return base64 ? 4 * Math.ceil(size / 3) : size;
   }
   ```

   Import `isKnownBinaryExtension` from `../core/mime.ts`.

2. Give `collectFileBudget` a fifth parameter `binary: boolean`. Charge
   `budgetBytes(path, Math.min(out.stats.size, maxSize), binary)` instead of
   `Math.min(out.stats.size, maxSize)`. Pass `args.binary` from `run`.

**Verify**: the read tests → pass. Then
`npm test -- --test-name-pattern="batch|budget|maxTotalSize"` → all pass. If an
existing image-batch test now skips an image, STOP and report its sizes.

**Commit**: `feat(read): a batch charges base64 files their encoded size`

### Step 6: Stdio oversize remedy for a resource block

**Files**: `src/tools/read.ts`, `__tests__/outbound-regressions.test.ts`.

**Test first**: next to `'read keeps its own remedies through the shared guard'`
(`:388`):

```ts
it('read with binary over stdio refuses an oversize resource with an HTTP remedy', async () => {
  const result = await harness.client.callTool(
    { name: 'read', arguments: { path: binaryFile, binary: true } },
    { timeout: 5000 },
  );
  assert.strictEqual(result.isError, true);
  const text = firstTextBlock(result).text ?? '';
  assert.match(text, /^TOO_LARGE: .*stdio message limit\)\.\nThis binary file is too large/);
  assert.doesNotMatch(text, /head, tail/);
  await assertRecovery();
});
```

It must fail on the remedy text. If it passes, STOP.

**Change**: replace `oversizeRemedy` with:

```ts
// Media and binary resources cannot be sliced, so head/tail is no remedy.
oversizeRemedy: (result) => {
  const types = new Set(result.resources?.map((b) => b.type));
  if (types.has('image') || types.has('audio')) {
    return 'This media file is too large to return over the stdio transport; connect over HTTP, or raise it as a smaller file.';
  }
  if (types.has('resource')) {
    return 'This binary file is too large to return over the stdio transport; connect over HTTP.';
  }
  return 'Read a slice with head, tail, or startLine/endLine.';
},
```

**Verify**: the stdio tests → all pass, the media remedy test included.

**Commit**: `feat(read): an oversize binary resource over stdio points at HTTP`

### Step 7: Tool description and contract snapshot

**Files**: `src/tools/read.ts`, `__tests__/contract.test.ts.snapshot`.

**Change**: set the description to
`'Read text files, like cat: whole, or one slice via head, tail, or startLine/endLine. ' + 'Images and audio return as media; pass binary: true to get any other binary file whole as a base64 embedded resource.'`
Then run the snapshot update command, with no `FS_*` variables set.

**Verify**: `git diff __tests__/contract.test.ts.snapshot` shows only these
changes:

- the `read` description, at both places;
- a new `binary` property (boolean, default false, the step-2 description) in
  `read`'s input schema, also at both places.

Anything else is a STOP. Then `node --test __tests__/contract.test.ts` → pass.

**Commit**: `feat(read): describe binary: true in the read contract`

### Step 8: Docs and CHANGELOG

**Files**: `README.md`, `docs/client-guide.md`, `docs/configuration.md`,
`CHANGELOG.md`.

**Change**:

- `README.md:264` `read` row:
  `Reads one or many text files, whole or by line range, head, or tail. Images and audio come back as media; binary: true returns any other binary file as an embedded resource.`
- `docs/client-guide.md:319-321`: replace "other binary files fail with
  `Binary file detected.`" with: other binary files fail with
  `Binary file detected.` unless the call passes `binary: true`. Then a full
  read returns the file as a `resource` block (`resource.blob` is base64,
  `resource.mimeType` the type), and `_meta.results[].value` holds `size`
  and `kind`. Line ranges are refused for binary files.
- `docs/configuration.md:211-212`:
  `` `read` handles text files and returns images and audio as media. With `binary: true` it returns other binary files whole as an embedded resource, under the same `--max-file-size` cap; over stdio, a file above about 7 MiB is too large once base64-encoded. It refuses UTF-16 text files. ``
- `CHANGELOG.md`, `## [Unreleased]`:
  - `### Added`: **`read` can return any binary file.** With
    `binary: true`, a full read of a file that is not text, an image or audio
    (a PDF, zip, sqlite database, font, …) returns it as an embedded
    `resource` block with its MIME type and base64 bytes, instead of
    `Binary file detected.`. The size limit is unchanged. Line ranges of a
    binary file are still refused, and without the flag the refusal now
    names it ([#98](https://github.com/j0hanz/filesystem-mcp/issues/98)).
  - `### Changed`: **A batched `read` counts image, audio and binary files
    at their base64 size** against its 512 KiB budget, because that is what
    it returns.

Run `npx prettier --write README.md docs/client-guide.md docs/configuration.md CHANGELOG.md`.

**Verify**: `npm run check:static` → exit 0.

**Commit**: `docs(read): document binary: true`

### Step 9: Full check (dispatcher)

Run `npm run build && npm run check`. Expected: exit 0, and the coverage
floor still met (`npm run test:coverage`). Re-read the whole diff once for
leftovers: a stale "other binary files are rejected", or `blobData`
reaching `_meta`.

## STOP conditions

- The drift check shows a mismatch with "Current state".
- A "test first" assertion passes before its change (the step-4 guard test
  excepted).
- Step 3: an existing test asserts the bare `Binary file detected.` text
  through the `read` tool.
- Step 5: an existing image or audio batch test changes outcome.
- Step 7: the snapshot diff touches anything other than `read`'s
  description and its new `binary` property.
- Any test outside the ones this plan adds or names needs a change.

## Maintenance notes and follow-ups (not in this plan)

- **MIME types for the extra binary extensions.** `.docx`, `.xlsx`, `.pptx`,
  `.woff`/`.woff2`/`.ttf`/`.otf`, `.mp4`/`.mov`/`.webm`/`.mkv`/`.avi` and
  `.sqlite` sit in `EXTRA_BINARY_EXTENSIONS`, so a resource for them says
  `application/octet-stream`. Moving them into `EXT_MAP` with their real
  types (kind `binary`) leaves `isKnownBinaryExtension` unchanged and only
  improves `mimeType` for `read`, `stat`, `list` and `resources/read`. Leave
  `.bin`, `.dat` and `.db` generic.
- **svg returns as an `image` block.** Not every client accepts
  `image/svg+xml` as an image. Returning it as text would change
  `resources/read` too, so it needs its own plan.
- **`readRaw` trusts the stat'd size.** `fsReadFile(handle)` reads to EOF, so
  a file that grows after the stat exceeds the cap in memory.
  `readFileBufferWithLimit` (`src/core/read.ts:88`) is the bounded reader to
  switch to. This affects `resources/read` and media reads already.
- **Hash scope.** `contentHash` for a binary read is the SHA-256 of the raw
  bytes. For a text read it is the hash of the returned string (UTF-8). Both
  are "the bytes returned"; the docs need no change.
