# Run: Pass the CLI result through, keep the API key out of the server, and build every JSON-RPC error one way

Executing [`transport-batch.plan.md`](transport-batch.plan.md), started 2026-10-13 at `5efb4a1d`. Drift check: HEAD unchanged.

- **1** 2026-10-13: done. The pin "an API-keyed server marks its cacheable lists private" passes before any change, so the premise holds. Transport tests: `tests 75, fail 0`.
- **2** 2026-10-13: done. Build exits 0. The `apiKey` grep in `server.ts` and `stdio.ts` gives no output. Transport tests: `tests 75, fail 0`.
- **3** 2026-10-13: done. Build exits 0. The `runtimeConfig` and spread grep gives no output. Transport tests (cli print-config included): `tests 75, fail 0`.
- **4** 2026-10-13: done. Deviation: the inferred return type widened `jsonrpc` to `string`, and `wire.send` rejected it, as the plan anticipated.
  - The plan's suggested `Exclude<Id, undefined>` return type failed under `exactOptionalPropertyTypes`, because narrowing gave `Id & {}` and dropped `null`.
  - Resolved by keeping the generic free of `undefined`: `<Id extends string | number | null>(…, id: Id | undefined): { …; id?: Id; … }`.
  - Build and type-check exit 0. The `jsonrpc: '2.0'` grep in `stdio.ts` gives no output. Transport tests plus http-policy: `tests 108, fail 0`.
- **5** 2026-10-13: done. CHANGELOG entry added.
- **6** 2026-10-13: done. `npm run check` exits 0: `tests 677, pass 672, skipped 5, fail 0`. `src/` +39 / -49 (-10).

## Done

- [x] `npm run check` exits 0.
- [x] The HTTP cache-scope pin passes.
- [x] The `apiKey` grep in `server.ts` and `stdio.ts` gives no output.
- [x] The `jsonrpc: '2.0'` grep in `stdio.ts` gives no output.
- [x] The exported signatures are kept: `startServer` only renames `config` to `_config`, and `startHttpServer` is unchanged.
- [x] The `src/` net delta is negative (-10).
- [x] `git status` shows the in-scope files plus the effort directory.
