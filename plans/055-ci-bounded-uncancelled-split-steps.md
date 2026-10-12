# Plan 055: CI runs are time-bounded, never cancelled on `main`, and report every failing check

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3da494ae..HEAD -- .github/workflows/ci.yml package.json AGENTS.md CONTRIBUTING.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW — CI configuration plus one test-runner flag; no runtime code.
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `3da494ae`, 2026-10-12

## Why this matters

Four gaps in `.github/workflows/ci.yml` and the test script make CI slower to
read and let commits reach `main` with no CI result:

1. **Pushes to `main` cancel each other.** The concurrency group is
   `ci-${{ github.ref }}` with `cancel-in-progress: true`, so a second push to
   `main` cancels the first push's run. Six `main` runs were cancelled this
   way (e.g. run 37676479706 for `c75c33c3`, a four-file `src/` fix that never
   got its own result; run 38144830686 for the PR #60 merge). The release
   workflow is then dispatched from commits whose own CI never finished.
2. **The `check` job has no `timeout-minutes`**, so a hung test holds a runner
   for GitHub's 360-minute default. Every other job in the repo sets one.
3. **`node --test` has no `--test-timeout`** (Node's default is `Infinity`).
   Many tests wait on child processes and `fs.watch` notifications, and one
   hung `await` fails the job without naming the test.
4. **One `npm run check` step chains six checks with `&&`.** A Prettier or
   knip failure stops the run before the 586 tests start, so the author (often
   an AI agent iterating on CI output) needs one extra push-and-wait cycle per
   failure class. The log shows only "Run npm run check failed".

After this plan: every `main` commit gets a complete CI result, a hang fails
in minutes with the test's name, and one run reports every failing check as
its own step.

## Current state

- `.github/workflows/ci.yml` (whole file, 46 lines). The relevant parts:

```yaml
on:
  push:
    branches: [main, dev]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    name: Check (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      # One OS failing must not cancel the other: the point is to see both.
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run check

  release-paths:
    name: Release build paths
    runs-on: ubuntu-latest
    timeout-minutes: 15
    ...
```

- `package.json:31-38` scripts:

```json
"build": "tsc -p tsconfig.json",
"lint": "eslint . --max-warnings=0",
"lint:fix": "eslint . --fix",
"format": "prettier --write .",
"type-check:test": "tsc -p tsconfig.test.json",
"check:static": "npm run build && npm run type-check:test && npm run lint && prettier --check . && knip",
"fix": "npm run format && npm run lint:fix && npm run check",
"check": "npm run check:static && npm run test",
"test": "node --test"
```

- The job **names** `Check (ubuntu-latest)`, `Check (windows-latest)` and
  `Release build paths` are what a later plan (064) makes required status
  checks. **Do not rename either job.**
- The longest single test today runs well under 10 s (`STDIO-017`, a 10 MiB
  create; full suite ~20 s locally, ~28 s on the Ubuntu runner). Only
  `__tests__/high-severity-fixes.test.ts:182,248` set a per-test
  `{ timeout: 5000 }`.
- `__tests__/dist-smoke.test.ts` needs `dist/` (it skips without it), so the
  test step must run after a successful build.

## Commands you will need

| Purpose        | Command                  | Expected on success             |
| -------------- | ------------------------ | ------------------------------- |
| Full check     | `npm run check`          | exit 0; `fail 0`, `cancelled 0` |
| Tests only     | `npm test`               | exit 0; `fail 0`, `cancelled 0` |
| Format check   | `npx prettier --check .` | exit 0                          |
| Timeout proven | see step 2               | the hung test fails ~2s         |

Baseline at planning time: 586 tests, 582 pass, 4 skipped (Windows), 0 fail.

## Scope

**In scope** (the only files you should modify):

- `.github/workflows/ci.yml`
- `package.json` — the `test` script only
- `plans/README.md` — status row

**Out of scope** (do NOT touch, even though they look related):

- `.github/workflows/release.yml` — plan 063 owns it.
- The `check`, `check:static` and `fix` scripts — local developers keep the
  single `npm run check` entry point; only CI splits the steps.
- Job names and the OS matrix — plans 062 and 064 depend on the current names.
- Adding a coverage step or new OS/Node legs — plans 058 and 062.
- Any `paths-ignore` / changed-files filter — skipped workflows leave required
  checks pending forever once plan 064 lands. Rejected on purpose.

## Git workflow

- Branch: `advisor/055-ci-bounded-uncancelled-split-steps`
- One commit, message in the repo's conventional style, e.g.
  `ci: bound the check job, keep main runs, split the check steps`
  (compare `git log --oneline -20`: `fix(tools): …`, `test(tools): …`, `docs(plan): …`).
- Commit only `.github/workflows/ci.yml` and `package.json` (plus the
  `plans/README.md` status row if the operator wants the index committed).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Per-test timeout in the test script

In `package.json`, change only the `test` script:

```json
"test": "node --test --test-timeout=60000"
```

`npm test -- --test-name-pattern="x"` keeps working: npm appends the extra
arguments after the existing ones.

**Verify**: `npm test` → exit 0, summary `fail 0` **and** `cancelled 0`,
same pass/skip counts as the baseline (582 pass / 4 skip on Windows). A test
that hits `--test-timeout` is counted as `cancelled`, not `fail`.

### Step 2: Prove the timeout fires (temporary file, deleted afterwards)

Create a throwaway file `__tests__/zz-hang.test.ts`:

```ts
import { it } from 'node:test';

it('hangs forever', async () => {
  await new Promise(() => {});
});
```

Run `node --test --test-timeout=2000 __tests__/zz-hang.test.ts`.

**Verify**: exit code non-zero within ~5 s, the summary shows
`cancelled 1`, and the output contains `test timed out after 2000ms`. Then **delete `__tests__/zz-hang.test.ts`**
and confirm `git status --short __tests__` prints nothing.

### Step 3: Rewrite the `check` job and the concurrency group in `ci.yml`

Replace the top-level `concurrency:` block (column 0) with:

```yaml
# Pull requests cancel their own superseded runs. Pushes get one group per
# ref and commit, so every commit on main/dev keeps a complete result: the
# release workflow checks that result before it tags (plan 063).
concurrency:
  group: ci-${{ github.ref }}-${{ github.event_name == 'pull_request' && 'pr' || github.sha }}
  cancel-in-progress: true
```

Replace the whole `check:` job with the block below. It sits under `jobs:`,
so **paste it exactly as indented here**: `check:` at 2 spaces, its keys at
4, step items at 6.

```yaml
check:
  name: Check (${{ matrix.os }})
  runs-on: ${{ matrix.os }}
  timeout-minutes: 15
  strategy:
    # One OS failing must not cancel the other: the point is to see both.
    fail-fast: false
    matrix:
      os: [ubuntu-latest, windows-latest]
  # Mirrors package.json's check script (check:static + test) as separate
  # steps, so one failure does not hide the others. Keep the two in sync.
  steps:
    - uses: actions/checkout@v6
    - uses: actions/setup-node@v6
      with:
        node-version-file: .nvmrc
        cache: npm
    - name: Install
      id: install
      run: npm ci
    - name: Build
      id: build
      run: npm run build
    - name: Type-check tests
      if: ${{ !cancelled() && steps.install.outcome == 'success' }}
      run: npm run type-check:test
    - name: Lint
      if: ${{ !cancelled() && steps.install.outcome == 'success' }}
      run: npm run lint
    - name: Format
      if: ${{ !cancelled() && steps.install.outcome == 'success' }}
      run: npx prettier --check .
    - name: Knip
      if: ${{ !cancelled() && steps.install.outcome == 'success' }}
      run: npx knip
    - name: Test
      # dist-smoke boots dist/index.js, so tests need a successful build.
      if: ${{ !cancelled() && steps.build.outcome == 'success' }}
      run: npm test
```

Why `!cancelled()`: a step without an `if:` is skipped once an earlier step
fails; `!cancelled()` runs it anyway (but still honours a cancelled run). The
`steps.install.outcome` guard keeps a failed `npm ci` from burying itself
under four missing-binary failures. Leave the `release-paths` job unchanged.

**Verify**: `git diff .github/workflows/ci.yml` shows only the concurrency
block, `timeout-minutes: 15`, the comment, and the steps list changing; the
job keys `check` / `release-paths` and both `name:` values are unchanged.

### Step 4: Validate the workflow file

1. `npx prettier --check .github/workflows/ci.yml` → exit 0 (Prettier formats
   YAML in this repo; if it reports a difference, run
   `npx prettier --write .github/workflows/ci.yml` and re-check).
2. If `actionlint` is installed, run `actionlint .github/workflows/ci.yml`
   (expected: no output). If it is not installed, skip this. Do not add a
   dependency for it. The CI run on the pushed branch is the final check.

3. Parse it (the `yaml` package is already in `node_modules`):

```bash
node -e "const y=require('yaml');const d=y.parse(require('fs').readFileSync('.github/workflows/ci.yml','utf8'));console.log(Object.keys(d.jobs).join(','), d.jobs.check['timeout-minutes'], d.jobs.check.steps.length)"
```

**Verify**: 4.1 exit 0; 4.3 prints exactly `check,release-paths 15 9`.

### Step 5: Full local check

**Verify**: `npm run check` → exit 0, `fail 0`, `cancelled 0`, counts equal
to the baseline.

## Test plan

- No new automated tests: this is CI configuration. Step 2 proves the
  per-test timeout is live; the deleted throwaway file must not be committed.
- When the branch is pushed (by the operator), the PR's CI run must show the
  six named steps (`Build`, `Type-check tests`, `Lint`, `Format`, `Knip`,
  `Test`) on both OS legs.

## Done criteria

Run the grep checks in Git Bash, not PowerShell.

- [ ] `package.json` `test` script is exactly `node --test --test-timeout=60000`
- [ ] `grep -n "timeout-minutes: 15" .github/workflows/ci.yml` → 2 matches (check + release-paths)
- [ ] `grep -n "github.event_name == 'pull_request' && 'pr' || github.sha" .github/workflows/ci.yml` → 1 match
- [ ] `grep -c "if: \${{ !cancelled()" .github/workflows/ci.yml` → 5
- [ ] `grep -n "run: npm run check" .github/workflows/ci.yml` → no matches
- [ ] Job names unchanged: `grep -n "name: Check (\${{ matrix.os }})\|name: Release build paths" .github/workflows/ci.yml` → 2 matches
- [ ] `__tests__/zz-hang.test.ts` does not exist
- [ ] `npm run check` exits 0
- [ ] `git diff --name-only main...HEAD` → exactly `.github/workflows/ci.yml`, `package.json`, and `plans/README.md` if you updated the status row (untracked `plans/0xx-*.md` files that already existed are expected)

## STOP conditions

Stop and report back (do not improvise) if:

- Any existing test is reported as `cancelled` with `test timed out after
60000ms`. That test is genuinely slow or hung, so report its name rather
  than raising the limit.
- Step 2's throwaway test does not time out — the flag is not honoured by the
  installed Node (`node --version` must be 24.x); report the version.
- The drift check shows `ci.yml` already changed (for example a coverage step
  or new matrix legs exist). Report it instead of merging the two by hand.

## Maintenance notes

- `ci.yml`'s steps now duplicate `check:static`'s list. When a check is added
  to `check:static`, add a matching step (the comment above `steps:` says so).
- The per-commit concurrency group for pushes means a burst of pushes to
  `main` runs every commit. That costs runner minutes (free on this public
  repo) and is the point: plan 063's release gate reads the result for the
  exact commit being released.
- Plans 058 (coverage floor) and 062 (macOS / Node 26 legs) edit this job
  next; they assume the step layout above.
