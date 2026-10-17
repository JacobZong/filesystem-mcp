# Plan: Pass the CLI result through, keep the API key out of the server, and build every JSON-RPC error one way

> **Executor rules**: work the steps in order. Run every Verify command and
> confirm its expected result before moving on. On any STOP condition, stop and
> report the condition, the step, and the evidence.
>
> **Written against** commit `5efb4a1d`, 2026-10-13.
> **Drift check (run first)**:
> `git diff --stat 5efb4a1d..HEAD -- src/index.ts src/cli.ts src/server.ts src/transport/shared.ts src/transport/stdio.ts src/transport/http.ts __tests__/http-server.test.ts CHANGELOG.md`
> Its file list is what narrows the excerpt match: compare
> [Current state](#current-state) against the live code for every file it
> flags. A mismatch is a [STOP](#stop) condition.

## Goal

Three transport-layer copies where one would do:

- `index.ts` rebuilds the parsed CLI result twice with conditional spreads,
  and `cli.ts` re-declares its type.
- `createServer` receives the bearer API key only to derive a cache-hint
  enum, so a secret travels deeper than it needs to.
- stdio hand-builds a JSON-RPC error literal next to the shared helper
  whose own comment says "A second hand-built literal is how the two
  drift apart".

When this lands, each fact has one source, the secret stops at the HTTP
host, and `src/` shrinks.

One accepted visible change ([T-04](tickets/T-04-behaviour-acceptance.md),
finding 10): a stdio server started with `FS_API_KEY` set now reports
`cacheScope: 'public'` to 2026-era clients instead of `'private'`. The key
has no meaning on stdio. Legacy clients see no cache hints at all.

Requirements covered: none, this is a refactor. Source: findings 5, 10 and
11 in [audit findings](assets/audit-findings.md).

## Current state

- [`src/index.ts:83-121`](../../../src/index.ts#L83-L121): the two
  rebuilds of the parsed CLI result.

  ```ts
  const { allowedDirs, allowCwd, port, readOnly, printConfig, httpHost, apiKey } = parsed;

  if (printConfig) {
    await runPrintConfig({
      allowedDirs,
      allowCwd,
      readOnly,
      ...(port !== undefined ? { port } : {}),
      ...(httpHost !== undefined ? { httpHost } : {}),
      ...(apiKey !== undefined ? { apiKey } : {}),
    });
    return;
  }
  …
  const serverOptions = { allowCwd, cliAllowedDirs: allowedDirs, readOnly };
  const runtimeConfig = {
    ...(httpHost !== undefined ? { httpHost } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
  };

  if (port !== undefined) {
    activeHttpServer = await startHttpServer(port, serverOptions, runtimeConfig);
  } else {
    registerShutdownTrigger('end');
    registerShutdownTrigger('close');
    activeStdioHandle = startServer(serverOptions, runtimeConfig);
  }
  ```

  `parsed` is typed `Awaited<ReturnType<typeof parseArgs>>`
  ([`index.ts:70`](../../../src/index.ts#L70)).
- [`src/cli.ts:137-145`](../../../src/cli.ts#L137-L145): `parseArgs()`
  returns
  `{ allowedDirs: string[]; allowCwd: boolean; port: number | undefined; readOnly: boolean; printConfig: boolean; httpHost: string | undefined; apiKey: string | undefined }`.
  [`cli.ts:220-228`](../../../src/cli.ts#L220-L228) declares
  `runPrintConfig(options: { allowedDirs: string[]; allowCwd: boolean; readOnly: boolean; port?: number; httpHost?: string; apiKey?: string })`.
  The body reads only `allowCwd`, `allowedDirs`, `readOnly`, `port`,
  `httpHost` and `apiKey`. Its only caller is `index.ts:86`. The repo sets
  `exactOptionalPropertyTypes` (`tsconfig.json:21`), which is why the
  spreads exist.
- [`src/transport/shared.ts:21-26`](../../../src/transport/shared.ts#L21-L26):

  ```ts
  export interface RuntimeConfig {
    /** `--http-host` or `FS_HTTP_HOST`. The HTTP bind defaults to loopback without it. */
    httpHost?: string;
    /** `--api-key` or `FS_API_KEY`. Unset means open access (loopback dev mode). */
    apiKey?: string;
  }
  ```

  [`shared.ts:34-45`](../../../src/transport/shared.ts#L34-L45),
  `jsonRpcError`:

  ```ts
  export function jsonRpcError<Id extends string | number | null>(
    code: number,
    message: string,
    id: Id,
  ): { jsonrpc: typeof JSONRPC_VERSION; id: Id; error: { code: number; message: string } } {
    return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
  }
  ```

  Callers: `http-policy.ts:49` (id defaults to `null`), and `stdio.ts:363`
  and `stdio.ts:381`, both with a defined id.
- [`src/server.ts:73-79`](../../../src/server.ts#L73-L79): `extraDeps.apiKey?: string`,
  with a 6-line comment explaining why the secret is not on `ServerOptions`.
  Its only use is [`server.ts:102`](../../../src/server.ts#L102):
  `const cacheScope: 'private' | 'public' = extraDeps?.apiKey ? 'private' : 'public';`.
  `cacheScope` then feeds `tools/list`, `prompts/list`,
  `resources/templates/list`, `server/discover` (`:113-125`) and the deps
  (`:193`).
- [`src/transport/http.ts:307`](../../../src/transport/http.ts#L307):
  `...(apiKey !== undefined ? { apiKey } : {}),` inside the
  `createServer(...)` extra deps. `apiKey` is
  `const { apiKey } = config;` (`:263`).
- [`src/transport/stdio.ts:142`](../../../src/transport/stdio.ts#L142):
  `export function startServer(options: ServerOptions, config: RuntimeConfig = {}): StdioServerHandle {`.
  `config` is read only at
  [`:161`](../../../src/transport/stdio.ts#L161):
  `...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),`.
  `startServer` is part of the public `./transport` package export
  (`package.json` `exports`, re-exported by `src/transport.ts`), so its
  signature stays. Lint allows unused parameters prefixed `_`
  (`eslint.config.mjs:56`, `argsIgnorePattern: '^_'`).
- [`stdio.ts:305-320`](../../../src/transport/stdio.ts#L305-L320), the
  hand-built envelope:

  ```ts
      const id = oversized === 'progress token' && 'id' in message ? message.id : undefined;
      void wire
        .send({
          jsonrpc: '2.0',
          ...(id !== undefined ? { id } : {}),
          error: {
            code: ProtocolErrorCode.InvalidRequest,
            message: `Stdio ${oversized} exceeds ${String(MAX_STDIO_REQUEST_ID_BYTES)} JSON-encoded bytes. Use a shorter ${shorter}.`,
          },
        })
  ```

  The id must be **omitted**, not `null`, when undefined:
  `__tests__/stdio.test.ts:291` asserts `response.id === undefined`. The
  SDK rejects `id: null`. An earlier attempt was skipped for exactly that
  reason; this plan omits the key instead.
- **Test convention:** `bootHttpTest` in
  [`__tests__/http-server.test.ts:52-67`](../../../__tests__/http-server.test.ts#L52-L67)
  boots a server with `{ apiKey: TEST_API_KEY }`, and
  `http.makeClient(name)` returns a connected `Client`. Reading the
  discover hint copies
  [`__tests__/http-transport.test.ts:96-104`](../../../__tests__/http-transport.test.ts#L96-L104):
  `client.getDiscoverResult() as { cacheScope?: string } | undefined`.

## Commands

| Purpose         | Command                                                                                                                                           | Expected on success |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Build           | `npm run build`                                                                                                                                   | exit 0              |
| Type-check      | `npm run type-check:test`                                                                                                                         | exit 0              |
| Transport tests | `node --test --test-timeout=60000 __tests__/http-server.test.ts __tests__/http-transport.test.ts __tests__/stdio.test.ts __tests__/cli.test.ts`   | `ℹ fail 0`          |
| Full check      | `npm run check`                                                                                                                                   | exit 0              |

Baseline at `5efb4a1d`: transport tests `ℹ tests 74`, `ℹ pass 74`.
`stdio.test.ts` and `cli.test.ts` run `src/index.ts` as a subprocess, so
they exercise the real wiring.

## Scope

**In scope**: the only files to modify.

- [`src/index.ts`](../../../src/index.ts)
- [`src/cli.ts`](../../../src/cli.ts)
- [`src/server.ts`](../../../src/server.ts)
- [`src/transport/shared.ts`](../../../src/transport/shared.ts)
- [`src/transport/stdio.ts`](../../../src/transport/stdio.ts)
- [`src/transport/http.ts`](../../../src/transport/http.ts)
- [`__tests__/http-server.test.ts`](../../../__tests__/http-server.test.ts)
- [`CHANGELOG.md`](../../../CHANGELOG.md)

**Files out of scope**: leave these alone even though they look related.

- [`src/transport.ts`](../../../src/transport.ts) and `package.json`
  `exports`: the public signatures of `startServer` and `startHttpServer`
  do not change.
- [`src/transport/http-policy.ts`](../../../src/transport/http-policy.ts):
  its `jsonRpcError` call passes `null` and must keep `id: null` on the
  wire.
- [`src/resources.ts`](../../../src/resources.ts): it receives
  `cacheScope` through deps and needs no change.

## Steps

### 1. Pin the HTTP cache scope before moving it (green)

In [`__tests__/http-server.test.ts`](../../../__tests__/http-server.test.ts),
inside `describe('Real HTTP Server integration')` and after test `2.`,
add:

```ts
it('an API-keyed server marks its cacheable lists private', async () => {
  const client = await http.makeClient('cache-scope');
  const discover = client.getDiscoverResult() as { cacheScope?: string } | undefined;
  assert.ok(discover, 'a modern connection must retain its discover result');
  assert.strictEqual(discover.cacheScope, 'private');
});
```

**Verify**: transport tests → `ℹ tests 75`, `ℹ fail 0`. The new test
passes today. If it fails, STOP: the premise that HTTP with a key reports
`private` is false.

### 2. The HTTP host decides the cache scope (finding 10)

1. [`src/server.ts`](../../../src/server.ts): replace the `apiKey?: string;`
   field and its 6-line doc comment (`:73-79`) with:

   ```ts
       /**
        * `private` when the HTTP host requires a bearer key, so a shared cache
        * never serves one tenant's listing to another. Default `public`.
        */
       cacheScope?: 'private' | 'public';
   ```

   Then change `:102` to
   `const cacheScope = extraDeps?.cacheScope ?? 'public';`.
2. [`src/transport/http.ts:307`](../../../src/transport/http.ts#L307):
   replace `...(apiKey !== undefined ? { apiKey } : {}),` with
   `cacheScope: apiKey ? 'private' : 'public',`.
3. [`src/transport/stdio.ts`](../../../src/transport/stdio.ts):
   - Delete the `:161` line.
   - Rename the parameter at `:142` to `_config: RuntimeConfig = {}`.
   - Above the function's existing doc comment end, add one line:
     ` * `_config` is unused: an API key has no meaning on stdio; the parameter keeps the export's signature.`.
     Put it inside the existing JSDoc block, as its last line.

**Verify**:

- Build → exit 0.
- `grep -rn "apiKey" src/server.ts src/transport/stdio.ts` → no output.
- Transport tests → `ℹ tests 75`, `ℹ fail 0`.

### 3. Pass the parsed CLI result through (finding 5)

1. [`src/transport/shared.ts`](../../../src/transport/shared.ts):
   `RuntimeConfig`'s two fields become `httpHost?: string | undefined;`
   and `apiKey?: string | undefined;`. Keep the doc comments.
2. [`src/cli.ts:220-228`](../../../src/cli.ts#L220-L228): replace the
   inline parameter type with
   `export async function runPrintConfig(options: Awaited<ReturnType<typeof parseArgs>>): Promise<void> {`.
   The body is unchanged: it reads only fields `parseArgs` returns, and
   `options.port !== undefined` and `options.httpHost ?? '127.0.0.1'` already
   handle `undefined`.
3. [`src/index.ts`](../../../src/index.ts):
   - The destructure becomes `const { allowedDirs, allowCwd, port, readOnly } = parsed;`.
   - The print-config block becomes
     `if (parsed.printConfig) { await runPrintConfig(parsed); return; }`
     (prettier formats it).
   - Delete the `runtimeConfig` object.
   - Call `startHttpServer(port, serverOptions, parsed)` and
     `startServer(serverOptions)`.

**Verify**:

- Build → exit 0.
- `grep -n "runtimeConfig\|httpHost !== undefined\|apiKey !== undefined" src/index.ts`
  → no output.
- Transport tests → `ℹ fail 0`. `cli.test.ts` covers `--print-config`,
  including `apiKey: '***'`.

### 4. One JSON-RPC error envelope (finding 11)

1. [`src/transport/shared.ts`](../../../src/transport/shared.ts),
   `jsonRpcError`: let `id` be `undefined` and omit the key then. Keep the
   doc comment, and add one sentence: "An `undefined` id is omitted, not
   sent as `null`: stdio refuses an oversized ID without echoing one."

   ```ts
   export function jsonRpcError<Id extends string | number | null | undefined>(
     code: number,
     message: string,
     id: Id,
   ) {
     return {
       jsonrpc: JSONRPC_VERSION,
       ...(id === undefined ? {} : { id }),
       error: { code, message },
     };
   }
   ```

   If lint's `explicit-function-return-type` (or a similar rule) demands a
   return type, use
   `{ jsonrpc: typeof JSONRPC_VERSION; id?: Exclude<Id, undefined>; error: { code: number; message: string } }`.
2. [`src/transport/stdio.ts:305-320`](../../../src/transport/stdio.ts#L305-L320):
   replace the `.send({ … })` literal with
   `.send(jsonRpcError(ProtocolErrorCode.InvalidRequest, \`Stdio ${oversized} exceeds ${String(MAX_STDIO_REQUEST_ID_BYTES)} JSON-encoded bytes. Use a shorter ${shorter}.\`, id))`.
   `jsonRpcError` is already imported in `stdio.ts`.

**Verify**:

- Build and type-check → exit 0.
- `grep -n "jsonrpc: '2.0'" src/transport/stdio.ts` → no output.
- Transport tests → `ℹ fail 0`. `stdio.test.ts:291` checks that an
  oversized-ID refusal carries no `id`.

### 5. CHANGELOG

Under `## [Unreleased]` → `### Changed`, at the end, add:

```markdown
- **The API key stops at the HTTP host.** The server used the key only to
  mark its cacheable lists `private`; the HTTP host now passes that scope
  instead of the secret. A stdio server started with `FS_API_KEY`, where
  the key has no effect, now reports those lists as `public` to 2026-era
  clients. The CLI result is passed through instead of being rebuilt
  twice, and stdio's oversized-ID refusal uses the shared JSON-RPC error
  builder.
```

**Verify**: `npx prettier --check CHANGELOG.md` → `All matched files use Prettier code style!`

### 6. Format and run the full check

`npx prettier --write src/index.ts src/cli.ts src/server.ts src/transport/shared.ts src/transport/stdio.ts src/transport/http.ts __tests__/http-server.test.ts CHANGELOG.md`

**Verify**: `npm run check` → exit 0. Record the test summary and
`git diff --numstat -- src`. Net `src/` must be negative; if it is not,
STOP.

## Done

- [ ] `npm run check` exits 0.
- [ ] The new HTTP cache-scope test passes.
- [ ] `grep -rn "apiKey" src/server.ts src/transport/stdio.ts` → no
      output.
- [ ] `grep -n "jsonrpc: '2.0'" src/transport/stdio.ts` → no output.
- [ ] `startServer` and `startHttpServer` keep their exported parameter
      lists (`git diff src/transport/stdio.ts src/transport/http.ts`
      shows only the `_config` rename).
- [ ] `src/` net line delta is negative.
- [ ] `git status --short` lists only the in-scope files plus this
      effort directory.

## STOP

Stop and report if:

- The code at a [Current state](#current-state) location does not match
  its excerpt.
- The step 1 pin fails before any change: the HTTP-with-key premise is
  false.
- `stdio.test.ts` sees an `id` key on the oversized-ID refusal, or the SDK
  rejects the new envelope's type at `wire.send`.
- `cli.test.ts`'s print-config assertions change (`apiKey: '***'`, the
  transport string). Finding 5 must not change `--print-config` output.
- Removing or retyping a parameter of `startServer` or `startHttpServer`
  appears necessary. Those are the public `./transport` export.
- The `src/` net delta is not negative after step 6.
- A step's verification fails twice after one fix attempt.

## Notes

- **What a reviewer should scrutinize:**
  - `jsonRpcError`'s inferred return type now makes `id` optional for
    every caller. HTTP still sends `id: null`, because only `undefined` is
    omitted.
  - `startHttpServer(port, serverOptions, parsed)` passes the whole parse
    result as `RuntimeConfig`. Only `httpHost` and `apiKey` are read.
- **Deferred:** none.
- **Rollback:** revert the PR.
