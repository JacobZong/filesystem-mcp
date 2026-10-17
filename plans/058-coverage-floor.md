# Plan 058: CI fails when `src/` test coverage drops below a recorded floor

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3da494ae..HEAD -- package.json .github/workflows/ci.yml AGENTS.md CONTRIBUTING.md`
> Plan 055 is expected to have changed `package.json` and `ci.yml`. Compare
> them with the "Current state" below, which describes the state **after 055**.
> Plan 057 may also have added `test-update-snapshots` lines to `AGENTS.md`
> and `CONTRIBUTING.md`; that is expected. Any other difference is a STOP
> condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW. The floor sits about 2 points below the measured numbers.
- **Depends on**: plan 055 (the split CI steps and the `--test-timeout` test script)
- **Category**: tests
- **Planned at**: commit `3da494ae`, 2026-10-12

## Why this matters

Coverage is never measured or enforced, so nothing stops a pull request (most
here are written by AI agents) from adding untested branches to the path
guard or the mutating tools. The suite is in good shape today. Measured on
Windows with Node 24.15, `src/**` only: **lines 94.01 %, branches 87.68 %,
functions 93.87 %**. A floor just below those numbers locks that in.
Node 24 has native thresholds, so this needs no dependency and costs about
4 s per run. The reference `modelcontextprotocol/servers` filesystem server
enforces a 90 % per-file floor in CI. This plan is the repo-wide equivalent.

Background: a report-only `test:coverage` script was suggested once and not
selected (`plans/README.md`, "Not audited this run" notes). This plan adds an
**enforced** floor instead.

## Current state (after plan 055)

- `package.json` `scripts.test`: `"node --test --test-timeout=60000"`.
  There is no coverage script.
- `.github/workflows/ci.yml`, job `check` (matrix `os: [ubuntu-latest, windows-latest]`).
  Its last step after plan 055:

```yaml
- name: Test
  # dist-smoke boots dist/index.js, so tests need a successful build.
  if: ${{ !cancelled() && steps.build.outcome == 'success' }}
  run: npm test
```

(Step items sit at 6 spaces under `steps:`.)

- Node 24 flags (from `node --help`): `--experimental-test-coverage`,
  `--test-coverage-include=...`, `--test-coverage-lines=...`,
  `--test-coverage-branches=...`, `--test-coverage-functions=...`. A run below
  a threshold exits non-zero.
- Without `--test-coverage-include`, the report also counts `dist/`,
  `eslint.config.mjs` and `__tests__/helpers.ts` (all-files lines about 72 %).
  The include filter is required.
- Coverage differs by OS. Linux-only code such as `src/core/fs.ts:127-147`
  (`#assertFdWithinRoots`, the `/proc/self/fd` re-check) is uncovered on
  Windows. Windows-only branches are uncovered on Linux. The floor is enforced
  on **Ubuntu only**, because that is where the POSIX sandbox branches run,
  and the Linux numbers have **not** been measured yet.

## Commands you will need

| Purpose      | Command                 | Expected on success             |
| ------------ | ----------------------- | ------------------------------- |
| Coverage run | `npm run test:coverage` | `fail 0`; exit 0; summary table |
| Tests        | `npm test`              | `fail 0`                        |
| Full check   | `npm run check`         | exit 0                          |

Baseline at planning time: 586 tests, 582 pass, 4 skipped (Windows), 0 fail.

## Scope

**In scope**:

- `package.json`: add one script, `test:coverage`
- `.github/workflows/ci.yml`: the `check` job's `Test` step only
- `AGENTS.md`, `CONTRIBUTING.md`: one line each
- `plans/README.md`: status row (and the measured numbers)

**Out of scope**:

- `npm test` and `npm run check` stay coverage-free for fast local runs.
- Per-file thresholds, coverage upload services (Codecov etc.), badges.
- Writing tests to raise coverage. Plan 060 does that for the data-loss
  guards.
- Excluding files from coverage to make the numbers look better.

## Git workflow

- Branch: `advisor/058-coverage-floor` (based on the branch or `main` that contains plan 055)
- One commit, e.g. `ci: enforce a src coverage floor on the ubuntu leg`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Measure locally

Run:

```bash
node --test --test-timeout=60000 --experimental-test-coverage --test-coverage-include="src/**"
```

Read the `all files` row of the coverage table at the end. Record its
**line %, branch %, funcs %**.

**Verify**: `fail 0`, and no metric is more than 2 points below
94.01 / 87.68 / 93.87 (Windows at planning). Higher is fine (plan 060 may
have landed first); use your numbers in step 2.

### Step 2: Add the script

Set each floor to the measured value rounded **down** to an integer, minus 2.
With the planning numbers that gives lines 92, branches 85, functions 91. In
`package.json`, after `"test"`:

```json
"test:coverage": "node --test --test-timeout=60000 --experimental-test-coverage --test-coverage-include=\"src/**\" --test-coverage-lines=92 --test-coverage-branches=85 --test-coverage-functions=91"
```

Use your step 1 numbers if they differ. The escaped double quotes keep
`src/**` from being glob-expanded by `sh` on Linux and still work in `cmd` on
Windows.

**Verify**: `npm run test:coverage` → exit 0, `fail 0`, and a coverage
table whose `all files` row is above all three floors.

### Step 3: Prove the floor fails a run (no files changed)

Run the same command with an impossible floor:

```bash
node --test --experimental-test-coverage --test-coverage-include="src/**" --test-coverage-lines=99 __tests__/smoke.test.ts
```

**Verify**: exit code 1 (PowerShell: `$LASTEXITCODE` → `1`), and the output
contains `line coverage does not meet threshold of 99%`.

### Step 4: Enforce it on the Ubuntu CI leg

In `.github/workflows/ci.yml`, replace the `Test` step with these two steps,
indented like the existing `- name: Build` step (6 spaces before `-`):

```yaml
- name: Test
  # dist-smoke boots dist/index.js, so tests need a successful build.
  if: ${{ !cancelled() && steps.build.outcome == 'success' && matrix.os != 'ubuntu-latest' }}
  run: npm test
- name: Test with coverage floor
  # Ubuntu runs the POSIX-only sandbox branches; the floor lives in
  # package.json test:coverage. Raise it when coverage rises; never lower it
  # without a recorded reason.
  if: ${{ !cancelled() && steps.build.outcome == 'success' && matrix.os == 'ubuntu-latest' }}
  run: npm run test:coverage
```

**Verify**: `npx prettier --check .github/workflows/ci.yml` → exit 0;
`grep -c "npm run test:coverage" .github/workflows/ci.yml` → 1.

### Step 5: Document

- `AGENTS.md` "## Commands" code block: add the line below after
  `npm test …`, keeping the other lines unchanged (its `#` sits one column
  further right than the others; that is fine):

```bash
npm run test:coverage # tests + src coverage floor (CI enforces it on ubuntu)
```

- `CONTRIBUTING.md` "## Checks" table: insert this row after the `npm test`
  row:

```markdown
| `npm run test:coverage` | Tests plus the src coverage floor CI enforces on Ubuntu |
```

Then run `npx prettier --write AGENTS.md CONTRIBUTING.md`. It re-pads the
whole table, and that diff is expected.

**Verify**: `npx prettier --check AGENTS.md CONTRIBUTING.md` → exit 0, and
`npm run check` → exit 0.

### Step 6: First Ubuntu run (when the operator pushes the branch)

The Ubuntu numbers are unmeasured.

- **If the operator has not pushed the branch:** set the `| 058 |` status
  cell to `IN PROGRESS (windows: L/B/F, floor L/B/F; ubuntu unmeasured, step 6 pending)`
  and stop here.
- **If it was pushed:** read the Ubuntu row with
  `gh run view <run-id> --log --job <ubuntu-job-id> | grep "all files"`
  (`gh run view <run-id> --json jobs` lists the job ids). Whether the step
  passed or failed: for each metric, new floor = min(current floor,
  floor(Ubuntu value) − 2). If any floor changed, update `package.json` and
  commit. Push only if the operator instructed it. If Ubuntu is more than 3
  points below Windows on any metric, STOP instead. Record
  `DONE (ubuntu: L/B/F, floor L/B/F)` in the `| 058 |` status cell.

## Test plan

- No new test files. Step 3 proves the threshold fails a run. Step 6 proves
  it on the gate OS.

## Done criteria

Run the grep checks in Git Bash.

- [ ] `npm run test:coverage` exits 0 locally
- [ ] `grep -n "\"test:coverage\"" package.json` → 1 match, containing `--test-coverage-include=\"src/**\"`
- [ ] `grep -n "npm test$\|npm run test:coverage" .github/workflows/ci.yml` → 2 matches, gated by `matrix.os != 'ubuntu-latest'` and `== 'ubuntu-latest'`
- [ ] `npm run check` exits 0 (unchanged, no coverage)
- [ ] `AGENTS.md` and `CONTRIBUTING.md` mention `test:coverage`
- [ ] `git diff --name-only main...HEAD` → only `.github/workflows/ci.yml`, `AGENTS.md`, `CONTRIBUTING.md`, `package.json` (and `plans/README.md` if committed)
- [ ] `plans/README.md` row updated: Windows numbers always, plus Ubuntu numbers if step 6 ran

## STOP conditions

Stop and report back (do not improvise) if:

- The step 1 numbers are more than 2 points below the planning numbers.
- The coverage run fails tests that pass under `npm test`. Coverage
  instrumentation changed behaviour, so report which test.
- Ubuntu coverage is more than 3 points below Windows on any metric (step 6).
  The gap means some POSIX branches are untested on the leg meant to cover
  them, and that deserves a look before a floor is set.
- The drift check shows plan 055 did not land. This plan's `ci.yml` edit
  assumes the split steps.

## Maintenance notes

- This is a ratchet. When coverage rises by about 2 points, raise the floors
  in `package.json`. Lower one only with a recorded reason in the commit
  message.
- Plan 062 adds a Node 26 Ubuntu leg. It must keep coverage on exactly one
  leg, which its plan handles with a matrix flag. Watch for the coverage
  step running twice.
- Coverage of code that runs inside spawned server subprocesses (the stdio
  and CLI tests) may or may not be counted, depending on how Node propagates
  `NODE_V8_COVERAGE`. The floor is relative to whatever is measured today,
  so this does not matter unless the test harness changes.
