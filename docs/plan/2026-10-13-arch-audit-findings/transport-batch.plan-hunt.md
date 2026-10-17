Status: clean

# Plan hunt: Pass the CLI result through, keep the API key out of the server, and build every JSON-RPC error one way

Hunted [`transport-batch.plan.md`](transport-batch.plan.md) at `5efb4a1d`,
2026-10-13.

## Confirmed

none

## Suspected

none

## Coverage

- **Drift check:** HEAD is the commit the plan was written against.
- **Current state:** every cited line was re-opened. The stdio envelope
  range was tightened to `:305-320` before this hunt. `stdio.test.ts:291`
  asserts `response.id === undefined`, as the plan states.
- **Commands:** the build, `type-check:test` and the transport tests
  (74/74) were run at `5efb4a1d`.
- **Step 1:** `bootHttpTest` boots with the test API key and connects
  with `versionNegotiation: 'auto'`. `getDiscoverResult()` is the accessor
  `http-transport.test.ts:100` already reads. A failure is a STOP, not a
  fix.
- **Step 2:** `startServer` is a public export, so the plan renames its
  parameter to `_config` rather than removing it. That passes
  `eslint.config.mjs:56` (`argsIgnorePattern: '^_'`).
- **Step 3:** `runPrintConfig` has one caller. `parseArgs`' return type
  has every field the body reads, and none of those reads changes.
- **Step 4:** no `explicit-function-return-type` rule exists, so the
  inferred return is allowed. If the generic spread does not narrow and
  `wire.send` rejects the inferred type, the build fails. A STOP names
  that case, and the plan gives the explicit return type to use.
- **Done and STOP:** both name risks specific to this change: the
  public signatures, `--print-config` output, the omitted `id`, and the
  net-deletion bar.
- **Refuter:** no candidate survived the step checks, so none was sent.
