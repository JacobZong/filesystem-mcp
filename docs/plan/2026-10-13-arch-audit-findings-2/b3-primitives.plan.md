# Plan: Each core primitive has one home, and the denylist's records name it

> **Executor rules**: work the steps in order. Run every Verify command and
> confirm its expected result before moving on. On any STOP condition, stop and
> report the condition, the step, and the evidence.
>
> **Written against** commit `cd242a8c`, 2026-10-13.
> **Drift check (run first)**:
> `git diff --stat cd242a8c..HEAD -- src/core/path-utils.ts src/core/sensitive.ts src/core/util.ts src/core/path.ts src/cli.ts src/transport/http.ts src/tools/list.ts src/tools/find-files.ts src/tools/search-text.ts src/tools/replace-text.ts`
> Its file list is what narrows the excerpt match: compare
> [Current state](#current-state) against the live code for every file it flags.
> A mismatch is a [STOP](#stop) condition.

## Goal

Finding 6 of the sixth architecture audit
([audit findings](assets/audit-findings.md), "6. Core primitives duplicated or
mishomed") plus finding 10's stale `sensitive.ts` anchor, batch B3 of
[the map](arch-audit-findings-2.map.md), ticket
[T-06](tickets/T-06-deliver-b3-primitives.md).

`CHAR_COLON` is declared twice and the Win32 trailing-dots/spaces trim is
written twice (once inline, once as a named arrow), so a fix to either lands in
one copy only — and the trim is a security-relevant denylist bypass guard.
`parseTrueEnvFlag` is env parsing living in the path-primitives module while
its siblings (`parseEnvInt`, `splitCsvList`) live in `util.ts`, and
`toPosixRelative` is a display-formatting helper living in the guard module
`path.ts`. Two records lie: `sensitive.ts`'s header says it "shares only" three
primitives (it imports four), and its comment cites
`getReservedDeviceName (path.ts)`, which lives in `path-utils.ts`. Pure moves;
no behavior change. Requirements covered: none, this is a refactor.

## Current state

- [`src/core/path-utils.ts`](../../../src/core/path-utils.ts) — the
  dependency-free primitives module. Header at
  [`path-utils.ts:4`](../../../src/core/path-utils.ts#L4):

  ```ts
  // ─── Shared primitives (no intra-package imports; every core module may import this) ──
  ```

  Imports at [`path-utils.ts:1-2`](../../../src/core/path-utils.ts#L1-L2):

  ```ts
  import { homedir, platform } from 'node:os';
  import { basename, delimiter, dirname, join, parse, resolve, sep, win32 } from 'node:path';
  ```

  `parseTrueEnvFlag` at
  [`path-utils.ts:44-57`](../../../src/core/path-utils.ts#L44-L57) (calls
  `warnInvalidSetting`, defined at
  [`path-utils.ts:30`](../../../src/core/path-utils.ts#L30), which STAYS here —
  `util.ts` and `observability.ts` import it, and keeping it here is what
  makes the move cycle-free):

  ```ts
  /**
   * Parse a boolean env flag: `true`/`1` enable, `false`/`0`/empty disable.
   * Any other value warns once per var (when `name` is given) and reads as
   * false, so a typo like `FS_ALLOW_SENSITIVE=yes` is never silent.
   */
  export function parseTrueEnvFlag(value: string | undefined, name?: string): boolean {
    if (value === undefined) return false;
    const trimmed = value.trim().toLowerCase();
    if (trimmed === 'true' || trimmed === '1') return true;
    if (name && trimmed !== '' && trimmed !== 'false' && trimmed !== '0') {
      warnInvalidSetting(name, value, '"true" or "1"', false);
    }
    return false;
  }
  ```

  `CHAR_COLON` and the inline trim, at
  [`path-utils.ts:80`](../../../src/core/path-utils.ts#L80) and
  [`path-utils.ts:108-113`](../../../src/core/path-utils.ts#L108-L113):

  ```ts
  const CHAR_COLON = 58;
  ...
  function getReservedDeviceName(segment: string): string | undefined {
    const trimmed = segment.replace(/[. ]+$/, '');
    const withoutStream = trimmed.split(':')[0] ?? '';
    const baseName = (withoutStream.split('.')[0] ?? '').toUpperCase();
    return RESERVED_DEVICE_NAMES.has(baseName) ? baseName : undefined;
  }
  ```

  `CHAR_COLON` is also used at
  [`path-utils.ts:151`](../../../src/core/path-utils.ts#L151) inside
  `normalizePath`.

- [`src/core/sensitive.ts`](../../../src/core/sensitive.ts) — the denylist.
  Header and imports at
  [`sensitive.ts:1-13`](../../../src/core/sensitive.ts#L1-L13):

  ```ts
  // Sensitive-file denylist policy: the compiled pattern set, the path
  // normalization that feeds it, and the NTFS alternate-data-stream stripping
  // Windows needs. Split out of path.ts so the denylist has its own home — it
  // shares only isAlpha / toPosixPath / IS_WINDOWS with the primitives in
  // path-utils.ts, not the allowed-directory assembly. path.ts and
  // path-completer.ts reach it through PathGuard.isSensitive, which delegates here.
  import { normalize, posix, sep } from 'node:path';

  import { cli } from './config.ts';
  import { IS_WINDOWS, isAlpha, parseTrueEnvFlag, toPosixPath } from './path-utils.ts';
  import { escapeRegExp } from './util.ts';

  const CHAR_COLON = 58;
  ```

  `stripAlternateDataStreams` and the duplicate trim at
  [`sensitive.ts:208-236`](../../../src/core/sensitive.ts#L208-L236):

  ```ts
  // Strip NTFS alternate-data-stream suffixes (the ":stream" after a segment)
  // before denylist matching, so `.env:secret` is caught as `.env`. Preserves the
  // drive-letter colon in the first segment of an absolute path. Also trims
  // trailing dots/spaces: Win32 strips them at the syscall boundary (a request
  // to create `.env ` actually creates `.env`), so without trimming them here the
  // exact-name patterns (`.env`, `.npmrc`) are bypassed on Windows. Mirrors the
  // precedent in getReservedDeviceName (path.ts) which trims for the same reason.
  function stripAlternateDataStreams(filePath: string): string {
    const parts = filePath.split(/[\\/]/);
    const stripped = parts.map((segment, i) => {
      if (
        i === 0 &&
        segment.length === 2 &&
        isAlpha(segment.charCodeAt(0)) &&
        segment.charCodeAt(1) === CHAR_COLON
      ) {
        return segment;
      }
      const colonIdx = segment.indexOf(':');
      const withoutStream = colonIdx !== -1 ? segment.slice(0, colonIdx) : segment;
      // Win32 strips trailing dots and spaces at the syscall boundary, so a
      // request for ".env " creates ".env". Strip them before denylist matching
      // or the exact-name patterns (".env", ".npmrc") are bypassed on Windows.
      return trimTrailingDotsAndSpaces(withoutStream);
    });
    return stripped.join(sep);
  }

  const trimTrailingDotsAndSpaces = (segment: string): string => segment.replace(/[. ]+$/, '');
  ```

  `parseTrueEnvFlag` call at
  [`sensitive.ts:311`](../../../src/core/sensitive.ts#L311).

- [`src/core/util.ts`](../../../src/core/util.ts) — env/config parsing home.
  Imports at [`util.ts:1-4`](../../../src/core/util.ts#L1-L4):

  ```ts
  import { availableParallelism } from 'node:os';

  import { cli } from './config.ts';
  import { warnInvalidSetting } from './path-utils.ts';
  ```

  Exemplar for the moved function's placement: `splitCsvList` at
  [`util.ts:45-56`](../../../src/core/util.ts#L45-L56), directly after
  `parseIntSetting`. `config.ts` has no imports, and `path-utils.ts` imports
  nothing in-package, so `util.ts` → `path-utils.ts` stays acyclic.

- [`src/core/path.ts`](../../../src/core/path.ts) — the guard module.
  Imports at [`path.ts:4`](../../../src/core/path.ts#L4) and
  [`path.ts:18-31`](../../../src/core/path.ts#L18-L31):

  ```ts
  import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
  ...
  import {
    getReservedDeviceNameForPath,
    IS_WINDOWS,
    isPathInsideDirectory,
    isPathWithinDirectories,
    isSamePath,
    isWindowsDriveRelativePath,
    normalizeAllowedDirectory,
    normalizePath,
    parseTrueEnvFlag,
    toPosixPath,
  } from './path-utils.ts';
  import { SensitiveMatcher } from './sensitive.ts';
  import { ROOTS_TIMEOUT_MS } from './util.ts';
  ```

  `toPosixRelative` at [`path.ts:102-105`](../../../src/core/path.ts#L102-L105)
  — the only use of `relative` and of `toPosixPath` in this file (the comment
  at [`path.ts:35`](../../../src/core/path.ts#L35) also names `toPosixPath`;
  it stays true):

  ```ts
  /** `path.relative` with forward slashes, so displayed paths match across platforms. */
  export function toPosixRelative(from: string, to: string): string {
    return toPosixPath(relative(from, to));
  }
  ```

  `parseTrueEnvFlag` calls at [`path.ts:741`](../../../src/core/path.ts#L741)
  and [`path.ts:755`](../../../src/core/path.ts#L755).

- Other callers (import lines only change):
  - [`src/cli.ts:11-17`](../../../src/cli.ts#L11-L17) imports
    `parseTrueEnvFlag` from `./core/path-utils.ts`; `src/cli.ts:20` already
    imports from `./core/util.ts`.
  - [`src/transport/http.ts:25`](../../../src/transport/http.ts#L25):
    `import { parseTrueEnvFlag } from '../core/path-utils.ts';`;
    `http.ts:29` already imports from `../core/util.ts`.
  - `toPosixRelative` from `../core/path.ts` at
    [`list.ts:11`](../../../src/tools/list.ts#L11) (list.ts also has a
    type-only `PathGuard` import from `../core/path.ts` at `:10`, which stays,
    and imports `../core/path-utils.ts` at `:9`),
    [`find-files.ts:5`](../../../src/tools/find-files.ts#L5),
    [`search-text.ts:8`](../../../src/tools/search-text.ts#L8),
    [`replace-text.ts:16`](../../../src/tools/replace-text.ts#L16).

- Conventions: imports are sorted by `@trivago/prettier-plugin-sort-imports`
  (`.prettierrc`), so run prettier on every touched file rather than ordering
  by hand. `knip` (in `npm run check`) fails on unused exports or imports.

- Decided (asset): `warnInvalidSetting` stays in `path-utils.ts`.
  `splitDirList` ([`path-utils.ts:59-65`](../../../src/core/path-utils.ts#L59-L65),
  sole caller `path-discovery.ts:28`) is "decide or record": this plan
  **records** it as staying — it splits on the platform path `delimiter`, a
  path-list primitive, unlike the comma-list `splitCsvList`. No test touches
  any of the four moved internals.

## Commands

| Purpose          | Command                                                    | Expected on success          |
| ---------------- | ---------------------------------------------------------- | ---------------------------- |
| Typecheck        | `npx tsc --noEmit -p tsconfig.json`                        | exit 0, no output after npm notices |
| Format           | `npx prettier --write <files>`                             | exit 0                       |
| Full check       | `npm run check`                                            | exit 0; `ℹ fail 0`           |
| Duplicate probe  | `grep -rn "CHAR_COLON = 58\|replace(/\[. \]+\$/" src`      | exactly one line each        |

## Scope

**In scope** — the only files to modify:

- [`src/core/path-utils.ts`](../../../src/core/path-utils.ts)
- [`src/core/sensitive.ts`](../../../src/core/sensitive.ts)
- [`src/core/util.ts`](../../../src/core/util.ts)
- [`src/core/path.ts`](../../../src/core/path.ts)
- [`src/cli.ts`](../../../src/cli.ts)
- [`src/transport/http.ts`](../../../src/transport/http.ts)
- [`src/tools/list.ts`](../../../src/tools/list.ts),
  [`src/tools/find-files.ts`](../../../src/tools/find-files.ts),
  [`src/tools/search-text.ts`](../../../src/tools/search-text.ts),
  [`src/tools/replace-text.ts`](../../../src/tools/replace-text.ts)

**Files out of scope** — leave alone even though they look related:

- [`src/core/observability.ts`](../../../src/core/observability.ts) — imports
  `warnInvalidSetting`, which does not move.
- [`src/core/path-discovery.ts`](../../../src/core/path-discovery.ts) —
  `splitDirList` stays (recorded above).
- `docs/adr/*` and [`src/transport/http-policy.ts`](../../../src/transport/http-policy.ts)
  — finding 10's other anchors belong to batch B4
  ([T-07](tickets/T-07-deliver-b4-records.md)).
- `__tests__/*` — no test imports a moved symbol; editing tests would hide a
  behavior change this refactor must not make.

## Steps

### 1. Share `CHAR_COLON` and the trailing-dots/spaces trim from `path-utils.ts`

In [`path-utils.ts`](../../../src/core/path-utils.ts):

- Change `const CHAR_COLON = 58;` (`:80`) to `export const CHAR_COLON = 58;`.
- Directly above `getReservedDeviceName` (`:108`), add the exported trim with
  the rationale moved here once:

  ```ts
  /**
   * Win32 strips trailing dots and spaces at the syscall boundary (a request for
   * `.env ` creates `.env`), so every name check must trim them first or it is
   * bypassed on Windows.
   */
  export const trimTrailingDotsAndSpaces = (segment: string): string =>
    segment.replace(/[. ]+$/, '');
  ```

- In `getReservedDeviceName`, replace `segment.replace(/[. ]+$/, '')` with
  `trimTrailingDotsAndSpaces(segment)`.

In [`sensitive.ts`](../../../src/core/sensitive.ts):

- Delete `const CHAR_COLON = 58;` (`:13`) and the `trimTrailingDotsAndSpaces`
  arrow (`:236`).
- Add `CHAR_COLON` and `trimTrailingDotsAndSpaces` to the
  `./path-utils.ts` import.
- In the `stripAlternateDataStreams` doc comment, replace the last three
  sentences ("Also trims trailing dots/spaces: ... Mirrors the precedent in
  getReservedDeviceName (path.ts) which trims for the same reason.") with:
  `Also trims trailing dots/spaces (see trimTrailingDotsAndSpaces in path-utils.ts), the same trim getReservedDeviceName applies.`
  This is finding 10's `sensitive.ts` anchor, now a grep-able symbol name.
- Delete the three-line inline comment inside the map callback ("Win32 strips
  trailing dots and spaces ... bypassed on Windows."); the rationale now lives
  on the shared function.

Run `npx prettier --write src/core/path-utils.ts src/core/sensitive.ts`.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0, and
`grep -rn "CHAR_COLON = 58\|replace(/\[. \]+\$/" src` → exactly two lines,
both in `src/core/path-utils.ts`.

### 2. Move `parseTrueEnvFlag` to `util.ts`

- Cut the function and its doc comment from
  [`path-utils.ts:44-57`](../../../src/core/path-utils.ts#L44-L57); paste it
  into [`util.ts`](../../../src/core/util.ts) directly after `splitCsvList`.
  `util.ts` already imports `warnInvalidSetting` from `./path-utils.ts`.
- Switch every importer from `path-utils.ts` to `util.ts`:
  - `src/cli.ts` — remove from the `./core/path-utils.ts` list; add to the
    `./core/util.ts` import.
  - `src/core/path.ts` — remove from the `./path-utils.ts` list; add to the
    `./util.ts` import.
  - `src/core/sensitive.ts` — remove from the `./path-utils.ts` list; add to
    the `./util.ts` import.
  - `src/transport/http.ts` — delete the `../core/path-utils.ts` import line;
    add to the `../core/util.ts` import.

Run `npx prettier --write src/core/path-utils.ts src/core/util.ts src/cli.ts src/core/path.ts src/core/sensitive.ts src/transport/http.ts`.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0, and
`grep -rn "parseTrueEnvFlag" src | grep "path-utils"` → no output.

### 3. Move `toPosixRelative` to `path-utils.ts`

- Cut the function and its one-line doc comment from
  [`path.ts:102-105`](../../../src/core/path.ts#L102-L105); paste it into
  [`path-utils.ts`](../../../src/core/path-utils.ts) directly after
  `toPosixPath` (`:76`), and add `relative` to the `node:path` import there.
- In `path.ts`, remove `relative` from the `node:path` import and `toPosixPath`
  from the `./path-utils.ts` import (both now unused).
- Switch the four tools from `../core/path.ts` to `../core/path-utils.ts`:
  `list.ts` (merge into its existing `../core/path-utils.ts` import; keep the
  type-only `PathGuard` import), `find-files.ts`, `search-text.ts`,
  `replace-text.ts`.

Run `npx prettier --write src/core/path.ts src/core/path-utils.ts src/tools/list.ts src/tools/find-files.ts src/tools/search-text.ts src/tools/replace-text.ts`.

**Verify**: `npx tsc --noEmit -p tsconfig.json` → exit 0, and
`grep -rn "toPosixRelative" src | grep "core/path.ts"` → no output.

### 4. Correct the `sensitive.ts` header

Replace the header sentence "it shares only isAlpha / toPosixPath /
IS_WINDOWS with the primitives in path-utils.ts, not the allowed-directory
assembly." with "it shares only character-level primitives from path-utils.ts,
not the allowed-directory assembly." — a claim that survives the next
primitive added, instead of a list that drifts.

**Verify**: `grep -n "shares only" src/core/sensitive.ts` → one line containing
`character-level primitives`.

### 5. Full check

**Verify**: `npm run check` → exit 0, `ℹ fail 0`, no knip findings.

## Done

- [ ] `npm run check` exits 0 (build, test typecheck, lint, prettier, knip, tests)
- [ ] `grep -rn "CHAR_COLON = 58" src` → one line, `src/core/path-utils.ts`
- [ ] `grep -rn "parseTrueEnvFlag(value" src` → one line, `src/core/util.ts`
- [ ] `grep -rn "export function toPosixRelative" src` → one line,
      `src/core/path-utils.ts`
- [ ] `grep -n "(path.ts)" src/core/sensitive.ts` → no output
- [ ] `git status --short` lists only in-scope files (plus this effort's
      `docs/plan/` records)

## STOP

Stop and report if:

- The code at a [Current state](#current-state) location does not match its
  excerpt.
- A step's verification fails twice after one fix attempt.
- The fix appears to require an out-of-scope file.
- Moving `parseTrueEnvFlag` to `util.ts` produces an import cycle (tsc or
  runtime `ReferenceError` / TDZ error at module load) — the plan assumes
  `path-utils.ts` imports nothing in-package and `util.ts` imports only
  `config.ts` and `path-utils.ts`.
- Any test changes outcome — every move here is behavior-identical, so a new
  failure means a symbol changed meaning, not that a test needs updating.
- The two trims turn out not to be byte-identical (`/[. ]+$/` on one segment)
  — sharing them would then change the denylist or the reserved-name check.

## Notes

- Review focus: the trim feeds the sensitive denylist on Windows. Confirm
  `stripAlternateDataStreams` still trims after stripping the stream and
  `getReservedDeviceName` still trims before splitting on `:` — order
  differs per caller and must not change.
- Deferred: `splitDirList` stays in `path-utils.ts` (recorded in Current
  state). Finding 10's other anchors ship in B4.
