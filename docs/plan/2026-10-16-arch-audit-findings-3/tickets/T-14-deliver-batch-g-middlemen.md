---
kind: frontier-ticket
id: T-14
title: Deliver batch G - fold the single-use validator hops (findings 9+10)
map: M-01
status: open
type: task
mode: afk
priority: 100
blocked_by: [T-07]
claimed:
---

## Question

Deliver findings 9 and 10 per [the audit asset](../assets/audit-findings.md),
only after [their premise](T-07-batch-g-premise-single-use-hops.md) resolved
live: inline `validateDirectoryPath` and `normalizeAndValidateDirs` into
their sole callers in `cli.ts`, and `resolveNamedRootContext` into its sole
caller in `path-completer.ts`. No behavior change. Drift check first
(`git diff 35c0daa0..HEAD -- src/cli.ts src/core/path-completer.ts`); a
premise mismatch — especially a second caller appearing — is a STOP. Own PR;
contract completion check; resolution links the PR.


Amendment 2026-10-16, from [the premise resolution](T-07-batch-g-premise-single-use-hops.md):
after folding `resolveNamedRootContext`, `findAllowedRootByName`
(`path-completer.ts:38`) becomes single-use — inline it too or leave it
deliberately, and name the choice in the PR.
