# Plan 075: Unicode-equivalent path spellings resolve to the on-disk entry

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report; do not improvise. The reviewer maintains `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat 8276c7e..HEAD -- src/core/path.ts src/core/path-utils.ts src/core/fs.ts src/tools/move.ts src/tools/create.ts __tests__/path-helpers.test.ts`
> If that prints anything, compare the "Current state" excerpts against the
> live code. On a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M (four code steps, one docs step)
- **Risk**: MED. The change is in `PathGuard`, the sandbox. It adds no new
  way in: the lookup runs only after a path has already failed with ENOENT
  and passed the lexical root check. It produces a spelling, and the existing
  containment and denylist checks then run on that spelling unchanged. Two
  behaviours change for everyone. A write to an equivalent name lands on the
  existing entry instead of creating a lookalike. `validatePathForDelete`
  probes the target before its parent (same syscalls, new order).
- **Depends on**: none
- **Category**: bug fix
- **Issue**: [#101](https://github.com/j0hanz/filesystem-mcp/issues/101)
- **Planned at**: commit `8276c7e`, 2026-10-15
- **Dry run**: steps 1–5 were applied in order to `8276c7e` in a scratch
  worktree, one commit per step. `npm run check:static` was green at every
  commit. The test-first runs failed exactly as each step says. At the end,
  `npm run check` was green (837 tests, 0 failures, 7 skipped) and
  `npm run test:coverage` met the floor (lines 95.61, branches 90.82,
  functions 94.76; `main` is 95.57 / 90.82 / 94.81). Two mutation checks
  confirmed that the move guard tests in step 2 fail when the guard they
  protect is removed. The replay also found an ordering trap: a read-only
  lookup without the write side breaks an NFD-to-NFC `move`. That is why
  step 3 lands both together.

## Why this matters

`list` shows an entry, but `read` of the name the model types back answers
`Path not found`. Reproduced at `8276c7e` on Linux (ext4) through `PathGuard`
and the in-memory client:

```text
validateExistingPath(<ws>/café/a.txt)    dir on disk is NFD     -> NOT_FOUND
validateExistingPath(<ws>/shot PM.txt)   name has U+202F        -> NOT_FOUND
validatePathForWrite(<ws>/café/new.txt)  dir on disk is NFD     -> <ws>/café/new.txt (a second, NFC café/)
validatePathForWrite(<ws>/shot PM.txt)   name has U+202F        -> <ws>/shot PM.txt (a lookalike sibling)
validatePathForDelete(<ws>/shot PM.txt)  name has U+202F        -> lexical path; rm then fails ENOENT
tools: read / create overwrite / move    same names             -> NOT_FOUND / second file / NOT_FOUND
```

Real cases: macOS stores names decomposed (NFD) on older volumes and in
archives; macOS screenshots put U+202F before `PM`; names copied from web
pages carry U+00A0. A model retypes all of them as NFC with U+0020 spaces,
and has no way to send the exact bytes back.

The reference server fixed this upstream (issue modelcontextprotocol/servers#1970,
PR modelcontextprotocol/servers#5009, merged 2026-10-05: `resolveUnicodeEquivalentPath`
and `unicodeMatchKey` in `src/filesystem/lib.ts`). This plan uses the same
match rule, exact-wins, and ambiguity refusal. It differs in four ways: it
starts at the nearest existing ancestor instead of the root, it skips
the directory scan for plain-ASCII names, it re-runs this server's existing
checks on the result instead of returning a real path, and it handles the
rename-to-own-variant case that upstream left as a known behaviour change.

## Decisions

These are settled. Do not revisit them during execution.

1. **Only on ENOENT, only below a root.** The fast path is untouched: an
   exact spelling that exists costs what it does today. The lookup runs
   after `validateAccess` (lexical root containment and the denylist on the
   typed path) and only when the typed path is missing. It never matches a
   component of the root's own path. A root is spelled as configured.
2. **Match key.** `unicodeMatchKey(name)` =
   `normalizeCaseForComparison(name.normalize('NFC').replace(/\p{Zs}/gu, ' '))`.
   NFC on both sides, every Unicode space separator (Zs: U+00A0, U+202F,
   U+2000–U+200A, U+3000, …) read as U+0020, and the case fold the guard
   already uses for "same path" on Windows and macOS. No NFKC: it would
   equate `ﬁ` with `fi` and full-width letters with ASCII, which is too
   broad. Tabs are not Zs.
3. **Exact wins, one match is used, several are refused, none keeps the
   tail.** For each missing component the parent directory is read once. If
   the typed name is an entry, it is used. Otherwise the single entry with
   the same key is used. Two or more fail with `INVALID_INPUT`
   `Ambiguous Unicode path component "<name>": N entries in <dir> match it (<spellings>)`.
   Each spelling there is printed with `\uXXXX` escapes, so the model can send the
   exact name as a JSON string. A match the denylist covers is refused with
   the denylist's `ACCESS_DENIED` first, so no hidden name is printed. No
   match ends the lookup: that component and
   the rest stay as typed, so `create`/`mkdir` still make them.
4. **A spelling, then the existing checks.** The lookup returns a path
   (on-disk names, unresolved), never a verdict. Before reading a directory
   it checks that directory's real path is inside the roots. After matching
   an entry it realpaths it and checks again, so a symlink found by
   equivalence cannot lead out (`ACCESS_DENIED`). The caller then runs the
   denylist on the re-spelled path and its unchanged
   realpath/containment/denylist pipeline on it.
5. **Plain-ASCII names skip the scan.** `mayHaveEquivalentSpelling(name)` is
   false for printable ASCII without a space, so `create new-file.ts` pays
   no `readdir`. Accepted miss: an on-disk name holding U+212A, U+037E or
   U+1FEF, which NFC maps to `K`, `;` and a backtick, is not found when
   typed in ASCII.
6. **Writes land on the existing entry.** `create shot PM.txt` with
   `overwrite: true` replaces the U+202F file. Without `overwrite`, it asks
   for the usual overwrite confirmation, naming the on-disk path.
   `create.ts:158-159` checks existence on the validated target. Once an
   equivalent entry exists, a lookalike sibling can no longer be created
   through this server. Upstream made the same call.
7. **Moves.** A destination that resolves to its own source by equivalence
   is a spelling-only rename, like today's case-only rename: `move` renames
   it, and `copy` is a no-op. Only a destination that resolved to the
   source gets this treatment. A move onto a separate on-disk lookalike
   (`a\u00a0b.txt` onto an existing `a\u202fb.txt`) is an ordinary existing
   destination, so it asks for confirmation and never silently overwrites.
8. **Delete leaves the last component unresolved.** `delete` and a move's
   source match the last name but do not realpath it, so deleting an
   in-root link that points outside still deletes the link
   (TC-PG-009 keeps passing).
9. **`stat` reports the on-disk spelling.** `validateExistingPathDetailed`
   returns the re-spelled path as `requestedPath`, so `isSymlink` stays false
   for a re-spelled regular file and `stat` prints the name as stored.
10. **No contract change.** No tool description, schema, or instruction
    text changes; `__tests__/contract.test.ts.snapshot` must not move.

## Current state

All at `8276c7e`.

- `src/core/path.ts:589-622` `validateExistingPathDetailed`: `validateAccess`,
  then `realpath(normalizedRequested)`. On any error it calls
  `handleRealpathError` (`:547-587`), which on ENOENT probes the nearest
  existing ancestor for an out-of-root symlink, then throws
  `NOT_FOUND 'Path not found'`. Returns
  `{ requestedPath: normalizedRequested, resolvedPath, isSymlink: !isSamePath(normalizedRequested, normalizedReal) }`.
- `src/core/path.ts:889-907` `validatePathForWrite`: `validateAccess`, then
  `resolveNearestExistingAncestor` (`:833-887`, which walks up with realpath
  and returns `{ realAncestor, resolvedTarget }`). When the whole path
  exists, `resolvedTarget === realAncestor`. Then it checks containment of
  both and the denylist on `resolvedTarget`.
- `src/core/path.ts:909-975` `validatePathForDelete`: root refusal, then
  `realpath(dirname(normalizedRequested))` (NOT_FOUND `Parent directory not found`
  on failure) and parent containment. Then a `try` that `lstat`s the target:
  it returns the link itself for a symlink, or the realpath after
  containment and the denylist, and falls through to `return normalizedRequested`
  on any non-`FsError` error.
- `src/core/path.ts:266-278` `allowedRootContaining`: longest allowed
  directory containing a path.
- `src/core/path-utils.ts:180-184` `normalizeCaseForComparison` (lowercase on
  win32/darwin); `:195-207` `respellCaseOnlyTarget(requestedPath, resolvedTarget)`
  re-spells the basename when `isSamePath` says the two differ only by case.
- `src/tools/move.ts:78-85` `TransferPlan.isCaseOnlyRename`;
  `:127-160` `planTransfer`: if `resolvedSource === resolvedDest`, it calls
  `respellCaseOnlyTarget`, then
  `isSelf = resolvedSource === resolvedDest` and
  `isCaseOnlyRename = !isSelf && isSamePath(resolvedSource, resolvedDest)`.
  A case-only rename skips the into-own-subdirectory check and `destExists`.
  `:207` repeats the `isCaseOnlyRename` exemption in the TOCTOU re-check.
- `src/core/fs.ts:35` imports `respellCaseOnlyTarget`; `:233-241` `rename`
  re-validates both paths and re-spells when `validOld === validNew`.
- `src/core/fs.ts:675-690` `destExists` probes through `fs.stat`, so through
  `validateExistingPath`. This is why the read and write sides must land
  together (step 3).
- No test anywhere uses a non-ASCII file name (`normalize(`, `NFC`, `NFD`:
  no matches in `__tests__/`).

## Commands you will need

The repo needs Node ≥ 24. If `node --version` prints less, prefix every
command with `npx -y -p node@24 --`. **This includes Prettier.** Under Node
22, `prettier --check .` flags 50 unchanged files at `8276c7e`, so a file
formatted under Node 22 fails `check:static` under 24.

| Purpose        | Command                                                                                                                                                                 | Expected on success |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Install        | `npm ci`                                                                                                                                                                | exit 0              |
| Static         | `npm run check:static`                                                                                                                                                  | exit 0              |
| New tests      | `node --test --test-timeout=60000 __tests__/unicode-paths.test.ts`                                                                                                      | all pass            |
| Helper tests   | `node --test --test-timeout=60000 __tests__/path-helpers.test.ts`                                                                                                       | all pass            |
| Guard tests    | `node --test --test-timeout=60000 __tests__/security.test.ts __tests__/path-guard-grant.test.ts __tests__/relative-paths.test.ts __tests__/aliased-root.test.ts`        | all pass            |
| Move tests     | `node --test --test-timeout=60000 --test-name-pattern="move\|rename\|copy" __tests__/tools.test.ts __tests__/mutation-regressions.test.ts __tests__/move-exdev.test.ts` | all pass            |
| Escape check   | see "Escapes" below                                                                                                                                                     | no output           |
| Format         | `npx prettier --write <files you touched>`                                                                                                                              | exit 0              |
| Full tests     | `npm test`                                                                                                                                                              | 0 failures          |
| Full check     | `npm run check`                                                                                                                                                         | exit 0              |
| Coverage floor | `npm run test:coverage`                                                                                                                                                 | exit 0              |

### Escapes

The tests and two doc comments spell names with `\u` escapes (`'caf\u00e9'`,
`'cafe\u0301'`, `'a\u00a0b.txt'`, `'shot\u202fPM.txt'`). They must reach the
file as backslash-u text. **Your file-writing tool may decode a `\uXXXX` in
your input into the character itself**. That happened in the dry run, and
ESLint's `no-irregular-whitespace` then failed on the U+202F. After every
edit, run this on the files you touched. It turns U+00A0, U+202F, U+0301 and
U+00E9 back into escapes and prints each file it changed:

```sh
node -e "const fs=require('fs');const bad=new RegExp('['+[0xa0,0x202f,0x301,0xe9].map(c=>String.fromCharCode(c)).join('')+']','g');for(const p of process.argv.slice(1)){const s=fs.readFileSync(p,'utf8');const t=s.replace(bad,c=>'\\\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));if(t!==s){fs.writeFileSync(p,t);console.log('re-escaped',p);}}" <files>
```

Run it on `.ts` files only, never on `README.md`, `docs/` or `CHANGELOG.md`.
Their prose uses a literal `é` on purpose. A second run must print nothing.

## Scope

**In scope**: `src/core/path-utils.ts`, `src/core/path.ts`,
`src/tools/move.ts`, `src/core/fs.ts` (one import and one call),
`__tests__/path-helpers.test.ts`, `__tests__/unicode-paths.test.ts` (new),
`README.md`, `docs/client-guide.md`, `CHANGELOG.md`.

**Out of scope**: `src/core/sensitive.ts`, `src/core/glob.ts`,
`src/core/path-completer.ts`, `src/resources.ts` (it gains the lookup
through `validateExistingPath` with no edit), every tool other than
`move`, `__tests__/contract.test.ts.snapshot`, `mcpb/`, `server.json`,
`package.json` versions, `plans/`.

## Git workflow

- Work on the branch the dispatcher names. Run the drift check against
  `8276c7e` first.
- One commit per step, with the message given in that step. End each message
  with the trailer the dispatcher gives you. Do not push unless the dispatcher
  says so.

## Execution model: one small Haiku agent per step

Each step is sized for one Haiku 5.5 agent (`model: haiku`) and uses the
same template: **Files**, **Test first**, **Change**, **Verify**,
**Commit**. The dispatcher sends each agent this plan's path, its step
number, and the branch. One step, one agent, one commit. The dispatcher
reads the diff and the Verify output before sending the next step. An
agent that hits a STOP condition reports it and makes no commit.

Before each commit, the agent runs the escape check (see "Escapes"), then
Prettier under Node 24 on the files the step touched. The pasted snippets
are not pre-formatted. Every commit must pass `npm run check:static`
(build, lint, Prettier, knip), so a step never adds an export that only a
later step uses. Exports used only by a test are fine: `knip.json` makes the
test files entries.

Order: 1 → 2 → 3 → 4 → 5, then 6 (dispatcher). Strictly sequential: steps
1–4 share `path-utils.ts`, `path.ts` and the new test file. **Step 2 must
land before step 3.** Without step 2, step 3 turns an NFD-to-NFC move into
a silent no-op. Step 2's second test catches that, and it was
mutation-checked in the dry run.

## Steps

### Step 1: The match key, and re-spelling a Unicode-only rename target (no behaviour change)

**Files**: `src/core/path-utils.ts`, `src/core/fs.ts`, `src/tools/move.ts`,
`__tests__/path-helpers.test.ts`.

**Change**:

1. In `src/core/path-utils.ts`, replace the whole `respellCaseOnlyTarget`
   doc comment and function (`:195-207`) with:

   ```ts
   /**
    * What two names share when they differ only in Unicode form (NFC or NFD) or
    * in which space character they use (U+0020, U+00A0, U+202F, and every other
    * Zs), case-folded where the filesystem folds case. A model types back
    * `caf\u00e9` and `shot PM.png` for the `cafe\u0301` and `shot\u202fPM.png` a
    * listing showed it (#101).
    */
   export function unicodeMatchKey(name: string): string {
     return normalizeCaseForComparison(name.normalize('NFC').replace(/\p{Zs}/gu, ' '));
   }

   /**
    * A write target that already exists is realpathed to its on-disk spelling,
    * so a rename that changes only case (`foo.txt` -> `Foo.txt` on a
    * case-insensitive filesystem) or only Unicode spelling (`cafe\u0301.txt` ->
    * `caf\u00e9.txt`) resolves to the source itself. Returns the resolved target
    * re-spelled with the requested basename when the two differ only that way;
    * otherwise the resolved target unchanged. Parent segments are not re-spelled.
    */
   export function respellSpellingOnlyTarget(
     requestedPath: string,
     resolvedTarget: string,
   ): string {
     const requestedName = basename(requestedPath);
     const resolvedName = basename(resolvedTarget);
     if (requestedName === resolvedName) return resolvedTarget;
     return unicodeMatchKey(requestedName) === unicodeMatchKey(resolvedName)
       ? join(dirname(resolvedTarget), requestedName)
       : resolvedTarget;
   }
   ```

2. In `src/core/fs.ts`: in the `./path-utils.ts` import (`:35`) rename
   `respellCaseOnlyTarget` to `respellSpellingOnlyTarget`. In `rename`
   (`:238-239`), replace the comment and call with:

   ```ts
   // Renaming a path onto itself is only meaningful as a case- or Unicode-only rename.
   if (validOld === validNew) validNew = respellSpellingOnlyTarget(newPath, validNew);
   ```

3. In `src/tools/move.ts`, rename `respellCaseOnlyTarget` to
   `respellSpellingOnlyTarget` in the import (`:26`) and the call (`:133`).
   Nothing else in `move.ts` changes in this step.

4. In `__tests__/path-helpers.test.ts`, rename every
   `respellCaseOnlyTarget` to `respellSpellingOnlyTarget` (the import and
   TC-PH-009/010/011, test names included). Add `unicodeMatchKey` to the
   `../src/core/path-utils.ts` import. Then append inside the `describe`,
   after TC-PH-011:

   ```ts
   it('TC-PH-013: unicodeMatchKey folds NFC/NFD and every space separator, not tabs', () => {
     assert.strictEqual(unicodeMatchKey('cafe\u0301'), unicodeMatchKey('caf\u00e9'));
     assert.strictEqual(unicodeMatchKey('shot\u202fPM'), unicodeMatchKey('shot PM'));
     assert.strictEqual(unicodeMatchKey('a\u00a0b'), unicodeMatchKey('a b'));
     assert.notStrictEqual(unicodeMatchKey('a\tb'), unicodeMatchKey('a b'));
   });

   it('TC-PH-014: respellSpellingOnlyTarget re-spells a Unicode-only match', () => {
     const resolvedTarget = join(tmpdir(), 'cafe\u0301.txt');
     assert.strictEqual(
       respellSpellingOnlyTarget('x/caf\u00e9.txt', resolvedTarget),
       join(tmpdir(), 'caf\u00e9.txt'),
     );
   });
   ```

**Test first**: none. TC-PH-013/014 are new unit tests of the new function.
TC-PH-009/010/011 must still pass after the rename.

**Verify**: escape check → no output. `npm run check:static` → exit 0.
Helper tests → all pass (2 skipped on Linux). Move tests → all pass.

**Commit**: `refactor(path): add the Unicode match key; re-spell Unicode-only rename targets`

### Step 2: A destination that resolves to its own source is a spelling-only rename (no behaviour change yet)

**Files**: `src/tools/move.ts`, `__tests__/unicode-paths.test.ts` (new).

**Test first**: create `__tests__/unicode-paths.test.ts` with exactly:

```ts
import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  cleanupTestRoot,
  createTestClientPair,
  createTestRoot,
  firstTextBlock,
} from './helpers.ts';

// Issue #101. Names are built from escapes so the source file's own
// normalization cannot change what lands on disk.
const NFC_CAFE = 'caf\u00e9';
const NFD_CAFE = 'cafe\u0301';
const NBSP_NAME = 'a\u00a0b.txt';
const NNBSP_NAME = 'a\u202fb.txt';

/**
 * True when this filesystem stores `NFD_CAFE` and `NFC_CAFE` as two names
 * (ext4, NTFS). APFS and HFS+ treat them as one, so the "on disk differs"
 * premise of the NFC/NFD cases does not hold there.
 */
async function isNormalizationSensitive(root: string): Promise<boolean> {
  const probe = join(root, 'norm-probe');
  await mkdir(probe);
  await writeFile(join(probe, NFD_CAFE), '');
  try {
    await readFile(join(probe, NFC_CAFE));
    return false;
  } catch {
    return true;
  }
}

describe('Unicode-equivalent path lookup (#101)', () => {
  let root: string;

  beforeEach(async () => {
    root = await createTestRoot();
  });

  afterEach(async () => {
    await cleanupTestRoot(root);
  });

  describe('through the tools', () => {
    it('a move onto a separate lookalike file is not a rename in place', async () => {
      await writeFile(join(root, NBSP_NAME), 'nbsp');
      await writeFile(join(root, NNBSP_NAME), 'nnbsp');
      const pair = await createTestClientPair([root]);
      try {
        await pair.client.callTool({
          name: 'move',
          arguments: {
            moves: [{ source: join(root, NBSP_NAME), destination: join(root, NNBSP_NAME) }],
          },
        });
        assert.strictEqual(await readFile(join(root, NBSP_NAME), 'utf8'), 'nbsp');
        assert.strictEqual(await readFile(join(root, NNBSP_NAME), 'utf8'), 'nnbsp');
      } finally {
        await pair.close();
      }
    });

    it('a move that only changes the normalization form still renames', async (t) => {
      if (!(await isNormalizationSensitive(root))) {
        t.skip('filesystem is normalization-insensitive');
        return;
      }
      await writeFile(join(root, `${NFD_CAFE}.txt`), 'x');
      const pair = await createTestClientPair([root]);
      try {
        const move = await pair.client.callTool({
          name: 'move',
          arguments: {
            moves: [
              {
                source: join(root, `${NFD_CAFE}.txt`),
                destination: join(root, `${NFC_CAFE}.txt`),
              },
            ],
          },
        });
        assert.notStrictEqual(move.isError, true, firstTextBlock(move).text);
        const names = (await readdir(root)).filter((name) => name.endsWith('.txt'));
        assert.deepStrictEqual(names, [`${NFC_CAFE}.txt`]);
      } finally {
        await pair.close();
      }
    });
  });
});
```

Run the new tests. **Both pass before the change.** They are guards for
step 3: the first proves a move onto a separate lookalike never becomes a
rename in place, and the second that a move changing only the Unicode form
still renames. (On macOS the second one skips, since APFS is
normalization-insensitive.)

**Change**: in `src/tools/move.ts`:

1. Rename the `TransferPlan` field `isCaseOnlyRename` to
   `isSpellingOnlyRename` everywhere in the file (`:85`, `:146`, `:160`,
   `:170`, `:207`). Replace its doc comment with:

   ```ts
   /**
    * A rename that only changes the destination's case or Unicode spelling
    * (#101). Move must perform it —
    * it is real work — so it is exempt from the destination-exists checks that
    * would otherwise read the source itself as an existing destination. Never
    * true for a copy, which treats such a target as a self-copy and skips.
    */
   ```

   and the `pending` field's comment with
   `/** Destination exists and is not a self or spelling-only target → needs overwrite confirmation. */`.

2. In `planTransfer`, replace everything from the comment
   `// validatePathForWrite realpaths an existing destination to its on-disk`
   through the line `if (isSelf || (isCaseOnlyRename && op === 'copy')) {`
   with:

   ```ts
     // validatePathForWrite realpaths an existing destination to its on-disk
     // spelling, so a rename that changes only case or Unicode spelling resolves
     // to the source itself; re-spell it with the requested basename before
     // deciding self vs. rename.
     const destIsSource = resolvedSource === resolvedDest;
     if (destIsSource) {
       validDest = respellSpellingOnlyTarget(pair.destination, validDest);
       resolvedDest = resolve(validDest);
     }

     const isSelf = resolvedSource === resolvedDest;
     // Only a destination that resolved to the source is renamed in place: onto
     // a separate `a\u202fb.txt`, a move of `a\u00a0b.txt` is an overwrite.
     const isSpellingOnlyRename =
       !isSelf && (destIsSource || isSamePath(resolvedSource, resolvedDest));

     // A copy onto a case-only or Unicode-only variant of its own source is the
     // same file, so it is a no-op; the same rename is real work for move and
     // proceeds.
     if (isSelf || (isSpellingOnlyRename && op === 'copy')) {
   ```

   The difference from today: `destIsSource` is computed **before** the
   re-spell. A re-spelled destination counts as a spelling-only rename
   because it resolved to the source, not because its key matches.

**Verify**: escape check → no output. `npm run check:static` → exit 0. New
tests → 2 pass. Move tests → 0 failures (the case-only rename test skips
on Linux).

**Commit**: `refactor(move): any destination that resolved to its own source is a spelling-only rename`

### Step 3: Read and write resolve a Unicode-equivalent spelling

**Files**: `src/core/path-utils.ts`, `src/core/path.ts`,
`__tests__/path-helpers.test.ts`, `__tests__/unicode-paths.test.ts`.

Read and write land in one step. A read-only lookup makes `destExists` (a
read probe) see an NFD source under its NFC destination name, while the
write side still resolves the NFC name to itself. `move` then refuses the
rename as an overwrite. The dry run hit exactly this.

**Test first**:

1. In `__tests__/unicode-paths.test.ts`, extend the imports to:

   ```ts
   import assert from 'node:assert/strict';
   import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
   import { join } from 'node:path';
   import { afterEach, beforeEach, describe, it } from 'node:test';

   import { ErrorCode } from '../src/core/errors.ts';
   import type { PathGuard } from '../src/core/path.ts';
   import {
     cleanupTestRoot,
     createTestClientPair,
     createTestRoot,
     firstTextBlock,
     fsErrorMatcher,
     makeGuard,
     trySymlink,
     withEnv,
   } from './helpers.ts';
   ```

2. Replace the constants block with:

   ```ts
   // Issue #101. Names are built from escapes so the source file's own
   // normalization cannot change what lands on disk.
   const NFC_CAFE = 'caf\u00e9';
   const NFD_CAFE = 'cafe\u0301';
   const NBSP_NAME = 'a\u00a0b.txt';
   const NNBSP_NAME = 'a\u202fb.txt';
   const ASCII_NAME = 'a b.txt';
   const NNBSP_SHOT = 'shot\u202fPM.txt';
   const ASCII_SHOT = 'shot PM.txt';
   ```

3. Insert this block inside the top-level `describe`, **before**
   `describe('through the tools', ...)`:

   ```ts
   describe('PathGuard', () => {
     let guard: PathGuard;

     beforeEach(async () => {
       guard = await makeGuard([root]);
     });

     it('reads through an NFC spelling of an NFD directory', async (t) => {
       if (!(await isNormalizationSensitive(root))) {
         t.skip('filesystem is normalization-insensitive');
         return;
       }
       await mkdir(join(root, NFD_CAFE));
       await writeFile(join(root, NFD_CAFE, 'a.txt'), 'nfd');
       const resolved = await guard.validateExistingPath(join(root, NFC_CAFE, 'a.txt'));
       assert.strictEqual(resolved, join(root, NFD_CAFE, 'a.txt'));
     });

     it('reads a U+202F name the request spells with U+0020', async () => {
       await writeFile(join(root, NNBSP_SHOT), 'shot');
       const resolved = await guard.validateExistingPath(join(root, ASCII_SHOT));
       assert.strictEqual(resolved, join(root, NNBSP_SHOT));
     });

     it('reports the on-disk spelling, not a symlink', async () => {
       await writeFile(join(root, NNBSP_SHOT), 'shot');
       const details = await guard.validateExistingPathDetailed(join(root, ASCII_SHOT));
       assert.deepStrictEqual(details, {
         requestedPath: join(root, NNBSP_SHOT),
         resolvedPath: join(root, NNBSP_SHOT),
         isSymlink: false,
       });
     });

     it('prefers the exact spelling when both are on disk', async () => {
       await writeFile(join(root, ASCII_NAME), 'space');
       await writeFile(join(root, NBSP_NAME), 'nbsp');
       assert.strictEqual(
         await guard.validateExistingPath(join(root, ASCII_NAME)),
         join(root, ASCII_NAME),
       );
       assert.strictEqual(
         await guard.validateExistingPath(join(root, NBSP_NAME)),
         join(root, NBSP_NAME),
       );
     });

     it('refuses a name that matches two entries and neither exactly', async () => {
       await writeFile(join(root, NBSP_NAME), 'nbsp');
       await writeFile(join(root, NNBSP_NAME), 'nnbsp');
       await assert.rejects(
         guard.validateExistingPath(join(root, ASCII_NAME)),
         fsErrorMatcher(ErrorCode.INVALID_INPUT, /Ambiguous Unicode path component.*\\u00a0/),
       );
       await assert.rejects(
         guard.validatePathForWrite(join(root, ASCII_NAME)),
         fsErrorMatcher(ErrorCode.INVALID_INPUT, /Ambiguous Unicode path component/),
       );
     });

     it('keeps NOT_FOUND when nothing matches', async () => {
       await assert.rejects(
         guard.validateExistingPath(join(root, 'no such file.txt')),
         fsErrorMatcher(ErrorCode.NOT_FOUND),
       );
     });

     it('never matches a component of the root itself', async () => {
       const top = await createTestRoot();
       try {
         await mkdir(join(top, 'my\u00a0root'));
         await writeFile(join(top, 'my\u00a0root', 'a.txt'), 'x');
         const narrow = await makeGuard([join(top, 'my root')]);
         await assert.rejects(
           narrow.validateExistingPath(join(top, 'my root', 'a.txt')),
           fsErrorMatcher(ErrorCode.ACCESS_DENIED),
         );
       } finally {
         await cleanupTestRoot(top);
       }
     });

     it('refuses a symlink reached by equivalence that escapes the root', async (t) => {
       const outside = await createTestRoot();
       try {
         await writeFile(join(outside, 'secret.txt'), 'outside');
         if (
           !(await trySymlink(outside, join(root, 'out\u00a0link'), () =>
             t.skip('symlink not permitted'),
           ))
         ) {
           return;
         }
         await assert.rejects(
           guard.validateExistingPath(join(root, 'out link', 'secret.txt')),
           fsErrorMatcher(ErrorCode.ACCESS_DENIED),
         );
         await assert.rejects(
           guard.validatePathForWrite(join(root, 'out link', 'new.txt')),
           fsErrorMatcher(ErrorCode.ACCESS_DENIED),
         );
         assert.deepStrictEqual(await readdir(outside), ['secret.txt']);
       } finally {
         await cleanupTestRoot(outside);
       }
     });

     it('applies the denylist to the on-disk spelling', async () => {
       await writeFile(join(root, 'secret\u202fnotes.txt'), 'secret');
       const denying = await withEnv({ FS_DENYLIST: 'secret\u202fnotes.txt' }, () =>
         makeGuard([root]),
       );
       await assert.rejects(
         denying.validateExistingPath(join(root, 'secret notes.txt')),
         fsErrorMatcher(ErrorCode.ACCESS_DENIED, /denylist/),
       );
       await assert.rejects(
         denying.validatePathForWrite(join(root, 'secret notes.txt')),
         fsErrorMatcher(ErrorCode.ACCESS_DENIED, /denylist/),
       );
     });

     it('writes into the existing NFD directory, not a new NFC sibling', async (t) => {
       if (!(await isNormalizationSensitive(root))) {
         t.skip('filesystem is normalization-insensitive');
         return;
       }
       await mkdir(join(root, NFD_CAFE));
       const target = await guard.validatePathForWrite(join(root, NFC_CAFE, 'new.txt'));
       assert.strictEqual(target, join(root, NFD_CAFE, 'new.txt'));
     });

     it('a write to a U+0020 spelling lands on the existing U+202F file', async () => {
       await writeFile(join(root, NNBSP_SHOT), 'shot');
       const target = await guard.validatePathForWrite(join(root, ASCII_SHOT));
       assert.strictEqual(target, join(root, NNBSP_SHOT));
     });
   });
   ```

4. Inside `describe('through the tools', ...)`, insert as its first test:

   ```ts
   it('create without overwrite asks before replacing the equivalent file', async () => {
     await writeFile(join(root, NNBSP_SHOT), 'shot');
     const pair = await createTestClientPair([root]);
     try {
       const create = await pair.client.callTool({
         name: 'create',
         arguments: { files: [{ path: join(root, ASCII_SHOT), content: 'again' }] },
       });
       assert.strictEqual(create.isError, true);
       assert.match(firstTextBlock(create).text ?? '', /overwrite: true/);
       assert.deepStrictEqual(await readdir(root), [NNBSP_SHOT]);
       assert.strictEqual(await readFile(join(root, NNBSP_SHOT), 'utf8'), 'shot');
     } finally {
       await pair.close();
     }
   });
   ```

Run the new tests. Expected before the change: 9 fail and 5 pass. The 5
that pass are `prefers the exact spelling…`, `keeps NOT_FOUND…`,
`never matches a component of the root itself` and the two step-2 move
guards. If any other test passes, or one of those five fails, STOP.

**Change**:

1. In `src/core/path-utils.ts`, insert directly **above** the
   `respellSpellingOnlyTarget` doc comment:

   ```ts
   /**
    * False for a name of printable ASCII with no space, which no other entry can
    * share a `unicodeMatchKey` with — except a name holding U+212A, U+037E or
    * U+1FEF, which NFC maps to ASCII; those stay unmatched. A missed lookup of
    * such a name skips the directory scan, so creating `new-file.ts` costs what
    * it did.
    */
   export function mayHaveEquivalentSpelling(name: string): boolean {
     return /[^\x21-\x7e]/u.test(name);
   }

   /** `name` with each non-ASCII code unit as a `\uXXXX` escape, which a JSON string argument accepts. */
   export function escapeNonAscii(name: string): string {
     return name.replace(/[^\x20-\x7e]/gu, (char) =>
       Array.from(
         { length: char.length },
         (_, index) => `\\u${char.charCodeAt(index).toString(16).padStart(4, '0')}`,
       ).join(''),
     );
   }
   ```

2. In `src/core/path.ts`:
   - add `readdir` to the `node:fs/promises` import (`:2`);
   - add `escapeNonAscii`, `mayHaveEquivalentSpelling` and `unicodeMatchKey`
     to the `./path-utils.ts` import (keep it alphabetical; Prettier's
     import sorter enforces it);
   - replace the whole `validateExistingPathDetailed` method (`:589-622`)
     with:

     ```ts
       async validateExistingPathDetailed(requestedPath: string): Promise<ValidatedPathDetails> {
         const { normalizedRequested, allowedDirs, accessDeniedHint } =
           this.validateAccess(requestedPath);

         let spelled = normalizedRequested;
         let realPath: string;
         try {
           realPath = await realpath(spelled);
         } catch (error) {
           // Not on disk as typed; it may be under another Unicode spelling (#101).
           const respelled = isNotFoundErrno(error)
             ? await this.respellMissing(spelled, allowedDirs, accessDeniedHint, requestedPath)
             : undefined;
           if (respelled === undefined) {
             realPath = await this.handleRealpathError(
               error,
               spelled,
               allowedDirs,
               accessDeniedHint,
               requestedPath,
             );
           } else {
             this.assertNotSensitiveFile(respelled, requestedPath);
             spelled = respelled;
             try {
               realPath = await realpath(spelled);
             } catch (retryError) {
               realPath = await this.handleRealpathError(
                 retryError,
                 spelled,
                 allowedDirs,
                 accessDeniedHint,
                 requestedPath,
               );
             }
           }
         }

         const normalizedReal = normalizePath(realPath);

         if (!isPathWithinDirectories(normalizedReal, allowedDirs)) {
           this.throwAccessDenied(requestedPath, accessDeniedHint);
         }

         // Re-check the resolved real path: a symlink inside an allowed root may
         // point at a sensitive file (e.g. link -> .env). The early check above only
         // sees the requested/normalized path, not the symlink target.
         this.assertNotSensitiveFile(normalizedReal, requestedPath);

         return {
           requestedPath: spelled,
           resolvedPath: normalizedReal,
           isSymlink: !isSamePath(spelled, normalizedReal),
         };
       }
     ```

   - replace the whole `validatePathForWrite` method (`:889-907`) with the
     two new private methods followed by the new `validatePathForWrite`:

     ```ts
       /**
        * `normalized` re-spelled with the on-disk names of the components that are
        * missing as typed but present under another Unicode spelling (#101), or
        * `undefined` when no component changed. Only names below a root are
        * matched, never the root's own. Each directory is scanned only after its
        * real path is checked to be inside the roots, and each matched entry is
        * realpathed and checked again, so a link found this way cannot lead out
        * (`resolveLast: false` leaves the last one unresolved, for delete). The
        * first component with no match ends the walk; it and the rest stay as
        * typed, so a write still creates them. The result is a spelling only:
        * the caller runs its own containment and denylist checks on it.
        */
       private async respellMissing(
         normalized: string,
         allowedDirs: readonly string[],
         accessDeniedHint: string,
         requestedPath: string,
         resolveLast = true,
       ): Promise<string | undefined> {
         const root = this.allowedRootContaining(normalized);
         if (root === undefined || !mayHaveEquivalentSpelling(normalized.slice(root.length))) {
           return undefined;
         }
         const missing: string[] = [];
         let ancestor = normalized;
         let real: string;
         for (;;) {
           try {
             real = normalizePath(await realpath(ancestor));
             break;
           } catch (error) {
             if (!isNotFoundErrno(error) || isSamePath(ancestor, root)) return undefined;
             missing.unshift(basename(ancestor));
             ancestor = dirname(ancestor);
           }
         }
         // An ancestor that resolves out of the roots is the caller's to refuse.
         if (!isPathWithinDirectories(real, allowedDirs)) return undefined;

         const spelled: string[] = [];
         for (const [index, name] of missing.entries()) {
           const onDisk = mayHaveEquivalentSpelling(name)
             ? await this.findEquivalentEntry(real, name, requestedPath)
             : name;
           if (onDisk === undefined) break;
           spelled.push(onDisk);
           if (!resolveLast && index === missing.length - 1) break;
           try {
             real = normalizePath(await realpath(join(ancestor, ...spelled)));
           } catch {
             // Missing as typed, or a dangling link: the caller's checks judge it.
             break;
           }
           if (!isPathWithinDirectories(real, allowedDirs)) {
             this.throwAccessDenied(requestedPath, accessDeniedHint);
           }
         }
         if (spelled.every((name, index) => name === missing[index])) return undefined;
         return join(ancestor, ...spelled, ...missing.slice(spelled.length));
       }

       /**
        * The entry of `realDir` that `name` names: `name` itself when it is
        * there, else the one entry with the same `unicodeMatchKey`. Two or more
        * such entries are refused, never chosen between. `undefined` when none
        * matches or the directory cannot be read.
        */
       private async findEquivalentEntry(
         realDir: string,
         name: string,
         requestedPath: string,
       ): Promise<string | undefined> {
         let entries: string[];
         try {
           entries = await readdir(realDir);
         } catch {
           return undefined;
         }
         if (entries.includes(name)) return name;
         const key = unicodeMatchKey(name);
         const matches = entries.filter((entry) => unicodeMatchKey(entry) === key);
         if (matches.length > 1) {
           throw new FsError(
             ErrorCode.INVALID_INPUT,
             `Ambiguous Unicode path component "${name}": ${String(matches.length)} entries in ${realDir} match it (${matches.map(escapeNonAscii).join(', ')}). Pass the exact name, using \\u escapes for the characters shown that way.`,
             requestedPath,
           );
         }
         return matches[0];
       }

       async validatePathForWrite(requestedPath: string): Promise<string> {
         const { normalizedRequested, allowedDirs, accessDeniedHint } =
           this.validateAccess(requestedPath);

         let { realAncestor, resolvedTarget } = await this.resolveNearestExistingAncestor(
           requestedPath,
           normalizedRequested,
         );
         const assertInside = (): void => {
           if (
             !isPathWithinDirectories(realAncestor, allowedDirs) ||
             !isPathWithinDirectories(resolvedTarget, allowedDirs)
           ) {
             this.throwAccessDenied(requestedPath, accessDeniedHint);
           }
         };
         assertInside();
         if (realAncestor !== resolvedTarget) {
           // Part of it is not on disk as typed; it may be under another Unicode
           // spelling (#101). Re-run the same checks on the on-disk spelling.
           const respelled = await this.respellMissing(
             normalizedRequested,
             allowedDirs,
             accessDeniedHint,
             requestedPath,
           );
           if (respelled !== undefined) {
             this.assertNotSensitiveFile(respelled, requestedPath);
             ({ realAncestor, resolvedTarget } = await this.resolveNearestExistingAncestor(
               requestedPath,
               respelled,
             ));
             assertInside();
           }
         }
         // Re-check the resolved target: a symlink inside an allowed root may point
         // at a sensitive file. Writing through such a link must be blocked too.
         this.assertNotSensitiveFile(resolvedTarget, requestedPath);
         return resolvedTarget;
       }
     ```

3. In `__tests__/path-helpers.test.ts`, add `escapeNonAscii` and
   `mayHaveEquivalentSpelling` to the `../src/core/path-utils.ts` import and
   append after TC-PH-014:

   ```ts
   it('TC-PH-015: mayHaveEquivalentSpelling is false only for printable ASCII without a space', () => {
     assert.strictEqual(mayHaveEquivalentSpelling('new-file.ts'), false);
     assert.strictEqual(mayHaveEquivalentSpelling('a b.txt'), true);
     assert.strictEqual(mayHaveEquivalentSpelling('caf\u00e9'), true);
   });

   it('TC-PH-016: escapeNonAscii writes each non-ASCII UTF-16 unit as a JSON escape', () => {
     assert.strictEqual(escapeNonAscii('a\u00a0b'), 'a\\u00a0b');
     assert.strictEqual(escapeNonAscii('x\u{1f600}'), 'x\\ud83d\\ude00');
   });
   ```

**Verify**: escape check → no output. `npm run check:static` → exit 0. New
tests → 14 pass on Linux. Helper, guard and move tests → all pass. Then
`npm test` → 0 failures. This is the riskiest step, so run the whole suite.

**Commit**: `fix(path): read and write resolve a Unicode-equivalent spelling (#101)`

### Step 4: Delete, and a move's source, resolve it too

**Files**: `src/core/path.ts`, `__tests__/unicode-paths.test.ts`.

**Test first**:

1. In `applies the denylist to the on-disk spelling`, append after the
   `validatePathForWrite` assertion:

   ```ts
   await assert.rejects(
     denying.validatePathForDelete(join(root, 'secret notes.txt')),
     fsErrorMatcher(ErrorCode.ACCESS_DENIED, /denylist/),
   );
   ```

2. Append as the last test of `describe('PathGuard', ...)`:

   ```ts
   it('deletes through an equivalent spelling', async () => {
     await writeFile(join(root, NNBSP_SHOT), 'shot');
     const target = await guard.validatePathForDelete(join(root, ASCII_SHOT));
     assert.strictEqual(target, join(root, NNBSP_SHOT));
   });
   ```

3. Insert as the first test of `describe('through the tools', ...)`:

   ```ts
   it('read, create and move resolve the equivalent spelling', async () => {
     await writeFile(join(root, NNBSP_SHOT), 'shot');
     const pair = await createTestClientPair([root]);
     try {
       const read = await pair.client.callTool({
         name: 'read',
         arguments: { path: join(root, ASCII_SHOT) },
       });
       assert.notStrictEqual(read.isError, true, firstTextBlock(read).text);
       assert.match(firstTextBlock(read).text ?? '', /shot/);

       const create = await pair.client.callTool({
         name: 'create',
         arguments: {
           files: [{ path: join(root, ASCII_SHOT), content: 'again', overwrite: true }],
         },
       });
       assert.notStrictEqual(create.isError, true, firstTextBlock(create).text);
       assert.deepStrictEqual(await readdir(root), [NNBSP_SHOT]);
       assert.strictEqual(await readFile(join(root, NNBSP_SHOT), 'utf8'), 'again');

       const move = await pair.client.callTool({
         name: 'move',
         arguments: {
           moves: [{ source: join(root, ASCII_SHOT), destination: join(root, 'b.txt') }],
         },
       });
       assert.notStrictEqual(move.isError, true, firstTextBlock(move).text);
       assert.deepStrictEqual(await readdir(root), ['b.txt']);
     } finally {
       await pair.close();
     }
   });
   ```

Expected before the change: exactly these 3 tests fail: the denylist test,
`deletes through…` and `read, create and move…` (its `move` fails
NOT_FOUND).

**Change**: in `src/core/path.ts`, replace the whole `validatePathForDelete`
method (`:909-975` before step 3; find it by name) with:

```ts
  async validatePathForDelete(requestedPath: string): Promise<string> {
    const { normalizedRequested, allowedDirs, accessDeniedHint } =
      this.validateAccess(requestedPath);

    // A workspace root is refused here, before the parent-containment check
    // below reaches for a parent that is out-of-root by construction and
    // reports "Outside allowed directories" for the one directory the caller
    // can see IS allowed. delete-file.ts keeps its own root check for the
    // nested-root case, where the parent is itself an allowed root and this
    // path is never taken.
    if (this.isAllowedRoot(normalizedRequested)) {
      throw new FsError(
        ErrorCode.ACCESS_DENIED,
        'Deleting a workspace root directory is not allowed',
        requestedPath,
      );
    }

    // Probe the final component before the parent, so a target that is not on
    // disk as typed can be re-spelled (#101) before either is checked.
    let target = normalizedRequested;
    let stats: Stats | undefined;
    try {
      stats = await lstat(target);
    } catch (error) {
      // The link itself is deleted, so the last component stays unresolved.
      const respelled = isNotFoundErrno(error)
        ? await this.respellMissing(target, allowedDirs, accessDeniedHint, requestedPath, false)
        : undefined;
      if (respelled !== undefined) {
        this.assertNotSensitiveFile(respelled, requestedPath);
        target = respelled;
        stats = await lstat(target).catch(() => undefined);
      }
    }

    const parent = dirname(target);
    let realParent: string;
    try {
      realParent = await realpath(parent);
    } catch (error) {
      throw new FsError(
        ErrorCode.NOT_FOUND,
        'Parent directory not found',
        requestedPath,
        error instanceof Error ? error : undefined,
      );
    }
    const normalizedRealParent = normalizePath(realParent);

    if (!isPathWithinDirectories(normalizedRealParent, allowedDirs)) {
      this.throwAccessDenied(requestedPath, accessDeniedHint);
    }

    // A target that does not exist needs only the parent check above.
    if (stats === undefined) return target;
    // For deletion, we ONLY block if the real target is outside the sandbox
    // IF the target is NOT a symlink. Deleting a symlink is safe even if it
    // points outside.
    if (stats.isSymbolicLink()) {
      // Symlink: check link sensitivity but don't resolve target.
      // The parent check above ensures the link itself is in an allowed root.
      this.assertNotSensitiveFile(target, requestedPath);
      return target;
    }

    // Not a symlink: resolve to catch path escapes (e.g. /allowed/dir/../../etc)
    // and block sensitive files. A probe failure (ENOENT and friends) falls
    // back to the parent check, which is sufficient for a path that does not
    // exist.
    let realTarget: string;
    try {
      realTarget = normalizePath(await realpath(target));
    } catch {
      return target;
    }
    if (!isPathWithinDirectories(realTarget, allowedDirs)) {
      this.throwAccessDenied(requestedPath, accessDeniedHint);
    }
    this.assertNotSensitiveFile(realTarget, requestedPath);
    return realTarget;
  }
```

The root refusal at the top is unchanged. The `lstat` now runs before the
parent `realpath`, so a missing target can be re-spelled before either is
checked. Every outcome for an exact spelling is the same as before.

**Verify**: escape check → no output. `npm run check:static` → exit 0. New
tests → 16 pass on Linux. Guard tests → all pass, including TC-PG-009 and
TC-PG-010. `npm test` → 0 failures.

**Commit**: `fix(path): delete and move resolve a Unicode-equivalent source (#101)`

### Step 5: Docs and CHANGELOG

**Files**: `README.md`, `docs/client-guide.md`, `CHANGELOG.md`.

**Change** (prose keeps a literal `é`; do not run the escape check here):

- `README.md`, the **Paths.** bullet (`:354-358`): after "so a result can
  be passed straight back." add:

  ```md
  A name that differs from the one on disk only
  in Unicode form (NFC or NFD) or in its space characters (U+00A0, U+202F)
  finds that entry.
  ```

- `docs/client-guide.md`, after the paragraph that ends "`~` expands to the
  home directory of the user running the server." (`:214-215`), add a new
  paragraph:

  ```md
  **A name spelled differently from the disk in Unicode still resolves.** When a
  name is not on disk as typed, the server compares it with the entries of its
  folder after NFC normalization, reading every space character as a plain
  space. `café` finds a folder stored decomposed (`cafe` plus U+0301), and
  `shot PM.png` finds a macOS screenshot whose name holds U+202F. This works for
  reads, writes, moves and deletes, below a root only: the root itself must be
  spelled as configured. A write lands on the entry it finds, so `create` asks
  before replacing it, as for any existing file. When two entries match, the
  call fails with `INVALID_INPUT` (`Ambiguous Unicode path component`) and shows
  each spelling with `\u` escapes; send the exact name. A name of plain ASCII
  with no space is never matched this way.
  ```

- `CHANGELOG.md`, `## [Unreleased]` → `### Fixed`, as the first entry:

  ```md
  - **A path that differs from the disk only in Unicode spelling resolves.**
    `café` finds a folder stored decomposed (NFD), and `shot PM.png` finds a
    macOS screenshot whose name holds U+202F. Both answered `Path not found`
    although `list` showed them. A name missing as typed is now compared with
    its folder's entries after NFC normalization, with every space character
    read as U+0020. One match is used and checked like any other path: root
    containment after each symlink, and the denylist on the on-disk name. Two
    matches are refused as ambiguous, and no match is still `NOT_FOUND`. A
    write to such a name lands on the existing entry, and a move that changes
    only a name's Unicode form renames it
    ([#101](https://github.com/j0hanz/filesystem-mcp/issues/101)).
  ```

Run `npx prettier --write README.md docs/client-guide.md CHANGELOG.md`.

**Verify**: `npm run check:static` → exit 0.

**Commit**: `docs: Unicode-equivalent path lookup (#101)`

### Step 6: Full check (dispatcher)

Run `npm run build && npm run check`. Expected: exit 0, about 837 tests,
0 failures. Then `npm run test:coverage` → exit 0. The dry run measured
lines 95.61, branches 90.82 and functions 94.76, against floors of 92, 85
and 91. One stdio test (`an edit over stdio links the file only when
resources/read can serve it`) timed out once under coverage load in the dry
run. It passed on re-run, and it passes alone on both `main` and the
change. If it fails, re-run it once by itself before treating it as real.

Re-read the whole diff once. Check that:
`git diff 8276c7e -- __tests__/contract.test.ts.snapshot` is empty; no
`respellCaseOnlyTarget` or `isCaseOnlyRename` is left
(`git grep -n "CaseOnly" -- src __tests__` → nothing); and the escape check
on every changed `.ts` file prints nothing.

## STOP conditions

- The drift check shows a mismatch with "Current state".
- A "test first" run differs from what the step says (which tests fail and
  which pass).
- `npm run check:static` fails for a reason other than formatting you can
  fix by running Prettier under Node 24.
- The contract snapshot changes.
- Any existing test outside `path-helpers.test.ts` needs an edit.
- The escape check keeps printing a file after a second run.
- On macOS or Windows CI, a test in `unicode-paths.test.ts` fails, as opposed
  to skipping. Report the platform and the test; do not adjust the test.

## Maintenance notes and follow-ups (not in this plan)

- **A root spelled differently from the disk.** A request through the NFC
  spelling of an NFD root fails the lexical root check before the lookup
  can run (decision 1). Upstream handles this with
  `respellAllowedDirectoryPrefix`. It would need care with
  `resolveRelativePaths` and `resultPaths`, so it is its own plan.
- **Path completion** (`src/core/path-completer.ts`) matches prefixes
  exactly, so `caf` + completion does not offer an NFD `café`. A
  `unicodeMatchKey`-based prefix compare would fix it.
- **Glob patterns** in `find_files`/`search_text` and `replace_text`'s glob
  do not fold Unicode. `**/café*` misses an NFD name.
- **Operator denylist patterns with non-ASCII** (`--deny 'café/**'`) are
  matched as typed. A request through the exact NFD spelling bypasses an
  NFC pattern. This is not new: it is true at `8276c7e`, with or without
  this plan. `SensitiveMatcher` could also test `unicodeMatchKey` of each
  segment.
- **Walk races.** `isEntryAccessible` validates walked entries, which
  exist, so it never reaches the lookup. An entry deleted mid-walk, whose
  name has two equivalent siblings, would surface `INVALID_INPUT` and stop
  the walk instead of being skipped. This is not worth code until seen.
- **`readdir` cost.** One full directory read per missing non-ASCII
  component, on the miss path only. A directory of 100k entries costs one
  scan per lookup.
- **Unreadable directory.** `findEquivalentEntry` returns `undefined` when
  `readdir` throws (EACCES). That leaves the original error to the caller's
  pipeline. The branch is uncovered (a root-run test cannot drop the
  permission).
