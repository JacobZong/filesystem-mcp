---
kind: frontier-map
id: M-01
title: Deliver the seventh audit's 12 findings on main
status: open
created: 2026-10-16T07:26:52Z
---

## Destination

All 12 findings of the seventh architecture audit (2026-10-15, at
`35c0daa0`) landed on `main` as eight shared-file-cluster batches, every
premise verified live before its edit. Full ranking, evidence, moves, and the
dropped list: [assets/audit-findings.md](assets/audit-findings.md).

## Notes

- Batches (shared-file clusters, settled by the user at charting):
  A = finding 1; B = 2; C = 3; D = 4+11; E = 5; F = 7+8; G = 9+10;
  H = 6+12. Shared files never split across open PRs (`read.ts` holds D,
  `search.ts` holds C+E, `util.ts` D, test `helpers.ts` H).
- Batch A ships alone first, as its own security-first PR with a CHANGELOG
  Security entry (fifth-audit T-03 precedent). Settled by the user.
- Findings 2 and 3 ship as behavior changes with CHANGELOG entries and pin
  tests — no write-specs pass. Settled by the user.
- Standing rule (fifth-audit delivery lesson): verify each premise against
  current code BEFORE editing; a mismatch is a STOP, not an adaptation.
- Refuted lists govern:
  `docs/plan/2026-10-12-arch-audit-findings/assets/audit-findings.md` and
  `docs/plan/2026-10-13-arch-audit-findings-2/assets/audit-findings.md`.
  Do not re-hunt their entries.
- The server ships no git tool; history and churn via shell git. File access
  through the repo's own filesystem-mcp tools where a choice exists.
- Amended 2026-10-16 after the premise fan-out: batch E dropped (finding 5
  fails the net-deletion gate, measured net ~0); batch F re-scoped to finding 7
  (finding 8's predicate is record-blessed by ADR-002:108-110). Seven batches
  remain — A, B, C, D, F (fold only), G, H — one delivery ticket each.
- Added 2026-10-16 from PR #106 review: the Codex fd-binding finding on
  `GuardedFileSystem.stat` is valid under the repo's H4 precedent; charted as
  [T-17](tickets/T-17-batch-a-followup-premise-fd-stat.md) (premise) and
  [T-18](tickets/T-18-deliver-batch-a-followup-fd-stat.md) (delivery).

### Execution contract

- Scope: the 12 findings in [assets/audit-findings.md](assets/audit-findings.md),
  delivered as the eight batches above; nothing else rides in a batch PR.
- Completion: `npm run check` exits 0 on each batch branch. No batch changes
  the advertised MCP surface, so the contract snapshot must stay untouched —
  any snapshot drift is a STOP and an investigation, not a refresh.
- Evidence: each batch ticket's resolution links its PR;
  `arch-audit-findings-3.run.md` carries the per-batch log.

## Decisions so far

- [Deliver batch D - base64EncodedBytes owner and sha256Hex helper (findings 4+11)](tickets/T-11-deliver-batch-d-base64-sha256.md) — delivered: both patterns have one owner; behavior-preserving; PR #109.
- [Deliver the #108 follow-up - hide sensitive ancestors in the walk filter](tickets/T-19-deliver-108-followup-sensitive-ancestors.md) — delivered: cached ancestor check in the walk filter closes the literal-prefix and symlink bypasses both reviews found; PR #110, awaiting user ruling.
- [Deliver batch C - prune sensitive directories in the shared walk (finding 3)](tickets/T-10-deliver-batch-c-sensitive-walk.md) — delivered: the walk filter prunes sensitive-named directories, all walkers inherit it, move's walk stays exempt; PR #108.
- [Deliver batch B - derive the skippable errno set (finding 2)](tickets/T-09-deliver-batch-b-skippable-errno.md) — delivered: the errno set is derived from the errno map x skippable codes, delta = EPERM; PR #107.
- [Deliver batch A - list's size stat through the guarded call (finding 1)](tickets/T-01-deliver-batch-a-guarded-list-stat.md) — delivered: the sizes stat re-validates each path before reading it; PR #106.
- [Batch B premise - is the skippable-errno EPERM divergence live?](tickets/T-02-batch-b-premise-skippable-errno.md) — LIVE: omission exact, derivation delta = EPERM only; symptom corrected — no listing-kill, the live impact is completer warn-noise and replace-text mis-recording raw EPERM.
- [Batch C premise - do find_files and search_text surface subtrees under denylist-named directories?](tickets/T-03-batch-c-premise-sensitive-subtree.md) — LIVE, confirmed empirically on the shipped v2.9.0: list hides the subtrees, find_files/search_text surface them; seam = optional pathGuard param on GlobEntriesOptions, move.ts's walk must not pass it.
- [Batch D premise - base64 formula x3 and sha256 chain x3, live?](tickets/T-04-batch-d-premise-base64-sha256.md) — LIVE: six cites verbatim, no fourth spelling, no refuted-list collision.
- [Batch E premise - how much do the two search scan drivers duplicate, and where does the shared driver live?](tickets/T-05-batch-e-premise-scan-drivers.md) — SHIFTED: ~20 shared lines, driver nets ~0; finding 5 fails the audit's own net-deletion gate.
- [Batch F premise - Unicode fold mirror and legacyHttp predicate, live?](tickets/T-06-batch-f-premise-fold-predicate.md) — split: the fold is LIVE (primitive foldUnicodeSpelling in path-utils, case modes stay per-site); the predicate is record-refuted by ADR-002:108-110, which blesses the double spelling.
- [Batch G premise - are the three single-use hops still single-use?](tickets/T-07-batch-g-premise-single-use-hops.md) — LIVE: all three single-caller with zero test references; findAllowedRootByName becomes single-use after the fold.
- [Batch H premise - 19 recompute pairs and 2 SSE parses, live?](tickets/T-08-batch-h-premise-test-helpers.md) — LIVE with a count shift: 16 strict pairs, shape intact, helper is a drop-in; SSE parse verbatim x2, half-owner is `post`.

## Not yet specified

- CHANGELOG wording and pin tests for the two behavior changes (findings 2, 3)
  — named at their batch deliveries, per the amended batch tickets.

## Out of scope

- Written-file value shape reopen (three destructure sites) — the findings-2
  refuted list blesses per-tool envelopes; reopens via write-adr only when its
  "fourth stat policy" trigger fires.
- [Deliver batch E - shared ordered-collect driver for search scans (finding 5)](tickets/T-12-deliver-batch-e-collect-driver.md) — out of scope: finding 5 failed the net-deletion gate at premise check (measured net ~0).
- Finding 8 (legacyHttp predicate dedupe) — dropped at premise check:
  ADR-002:108-110 deliberately blesses the predicate spelled twice; reopen
  only via write-adr.

## Superseded

- [Deliver batch F - one Unicode fold primitive and one legacyHttp predicate (findings 7+8)](tickets/T-13-deliver-batch-f-fold-predicate.md) — predicate half record-refuted (ADR-002:108-110); replaced by [Deliver batch F - one Unicode fold primitive (finding 7)](tickets/T-16-deliver-batch-f-fold-primitive.md).
