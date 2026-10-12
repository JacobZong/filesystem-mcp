# Plan 063: The Release workflow refuses a commit whose CI is not green on every required leg

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3da494ae..HEAD -- .github/workflows/release.yml .github/workflows/ci.yml`
> If `release.yml` changed since this plan was written, compare the
> "Current state" excerpts against the live file before proceeding; on a
> mismatch, treat it as a STOP condition. (`ci.yml` changes from plans 055,
> 058 and 062 are expected and do not affect this plan.)

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW. It adds a read-only pre-check and makes the push atomic. A
  wrong check name would block releases (the fail-safe direction), and
  step 4 tests the check against real history.
- **Depends on**: plan 055 (strongly recommended: since 055, every `main`
  commit gets its own CI run, so this gate always has a result to read)
- **Category**: dx
- **Planned at**: commit `3da494ae`, 2026-10-12

## Why this matters

The Release workflow (`workflow_dispatch`) re-runs `npm run check`, but **on
Ubuntu only**. Nothing reads the CI result for the commit being released, so:

- A Windows-only regression ships. Windows is half the CI matrix, and
  `7a04c08e` "fix(stat): stop implying a Windows directory is empty…" was
  pushed straight to `main` and released as v2.7.4 about 5 minutes later.
  It happened to be green, but nothing enforced that.
- The only gate is the human waiting for CI. Releases were dispatched 14 s
  (`9c7add8e`) and 10 s (`db3e1dce`) after CI finished, and twice after a
  flaky Ubuntu leg was re-run (plan 056).
- Once plan 064's ruleset is active, the workflow's
  `git push origin main --follow-tags` can be rejected for `main` while the
  **tag is still pushed** (a non-atomic push). The publish jobs then check out
  the tag and publish a version whose bump commit never reached `main`.

After this plan, a release starts only from a commit whose CI run is complete
and green on the required legs, and the branch and tag push succeed or fail
together.

## Current state

- `.github/workflows/release.yml`, the `release` job (`:33-141`):

```yaml
release:
  name: Release
  runs-on: ubuntu-latest
  timeout-minutes: 15
  permissions:
    contents: write
  outputs:
    version: ${{ steps.ver.outputs.version }}
  steps:
    - uses: actions/checkout@v6

    - uses: actions/setup-node@v6
      with:
        node-version: '24'

    # The publish step pushes HEAD to main, so a dispatch from any other
    # branch would fast-forward main onto that branch's tip.
    - name: Require dispatch on main
      run: |
        if [ "$GITHUB_REF_NAME" != "main" ]; then
          echo "::error::Release must be dispatched on main (got $GITHUB_REF_NAME)"
          exit 1
        fi

    # ... Configure git (:58-60), Determine version (:62-79, shown in
    # Step 3), Bump package.json, server.json and MCPB manifest (:81-118) ...
    - name: Install & validate
      run: |
        npm ci --ignore-scripts
        npm run check

    - name: Release-only build paths (Docker, MCPB, Smithery dry run)
      run: bash scripts/check-release-paths.sh

    - name: Commit, tag & push
      env:
        VERSION: ${{ steps.ver.outputs.version }}
      run: |
        git add package.json package-lock.json server.json mcpb/manifest.json
        git commit -m "release: v$VERSION"
        git tag -a "v$VERSION" -m "v$VERSION"
        git push origin main --follow-tags
```

The `Determine version` step at `:62-79` interpolates `${{ inputs.bump }}`
directly into the shell script (`case "${{ inputs.bump }}" in`). It is a
`choice` input, so this is harmless today, but it is the template-injection
shape that workflow linters flag.

- `.github/workflows/ci.yml`: workflow `name: CI`. On `push` to `main` it
  runs jobs named `Check (ubuntu-latest)`, `Check (windows-latest)` and
  `Release build paths` (plus non-required legs after plan 062:
  `Check (macos-latest)`, `Check (ubuntu-latest, node 26)`).
- A re-run attempt replaces a check run's conclusion, so a flaky leg that was
  re-run green reads as `success`.
- `$GITHUB_SHA` in a `workflow_dispatch` run on `main` is the commit at the
  tip of `main` when the run was dispatched, the one being released.
- The release skill at `.claude/skills/release/SKILL.md` is gitignored and
  local to the user, and it already checks CI (lines 39-40). Do not edit it.

## Commands you will need

| Purpose                 | Command                                                        | Expected on success |
| ----------------------- | -------------------------------------------------------------- | ------------------- |
| Format the YAML         | `npx prettier --check .github/workflows/release.yml`           | exit 0              |
| Lint workflow           | `actionlint .github/workflows/release.yml` (only if installed) | no output           |
| Dry-run the gate script | see step 4                                                     | as described        |

## Scope

**In scope**:

- `.github/workflows/release.yml`: a new step plus `permissions` in the
  `release` job; the push line; the `inputs.bump` interpolation
- `plans/README.md`: status row

**Out of scope**:

- The publish jobs (`publish-npm`, `publish-docker`, `publish-mcp`, `publish-mcpb`).
- Versions in `package.json` / `server.json` / `mcpb/manifest.json`. Never
  hand-edit them (AGENTS.md: "Never hand-edit any of those versions").
- Removing the release job's own `npm run check`. It validates the
  **bumped** tree, which CI never saw.
- `.nvmrc` vs the `node-version: '24'` literals. Same major today; leave them.
- Dispatching a real release to test this. Step 4 tests the gate script
  against history instead.

## Git workflow

- Branch: `advisor/063-release-requires-green-ci`
- One commit, e.g. `ci(release): refuse a commit without green CI; push atomically`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Gate step

In the `release` job. The snippets are shown at their **real indentation**
in the file: `permissions:` at 4 spaces and its keys at 6, step items at 6,
`env:`/`run:` at 8, the script body at 10.

1. Extend `permissions` to:

```yaml
permissions:
  contents: write
  # Read the CI check runs of the commit being released.
  checks: read
```

2. Insert this step directly **after** `Require dispatch on main`:

```yaml
# The release re-runs the checks on Ubuntu only. This reads the CI result for
# the exact commit being released, so a red or unfinished Windows leg (or a
# commit whose CI never ran) cannot ship.
- name: Require green CI for this commit
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    REQUIRED: 'Check (ubuntu-latest)|Check (windows-latest)|Release build paths'
  run: |
    runs=$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/check-runs?per_page=100" \
      --jq '.check_runs | sort_by(.id) | reverse | .[] | [.name, .status, (.conclusion // "none")] | @tsv')
    fail=0
    IFS='|' read -ra names <<< "$REQUIRED"
    for name in "${names[@]}"; do
      line=$(printf '%s\n' "$runs" | awk -F'\t' -v n="$name" '$1 == n' | head -n1)
      if [ -z "$line" ]; then
        echo "::error::No '$name' check run for $GITHUB_SHA — CI has not run on this commit"
        fail=1
      elif [ "$(printf '%s' "$line" | cut -f2)" != "completed" ]; then
        echo "::error::'$name' is still $(printf '%s' "$line" | cut -f2) for $GITHUB_SHA — wait for CI"
        fail=1
      elif [ "$(printf '%s' "$line" | cut -f3)" != "success" ]; then
        echo "::error::'$name' concluded $(printf '%s' "$line" | cut -f3) for $GITHUB_SHA"
        fail=1
      else
        echo "ok: $name"
      fi
    done
    exit "$fail"
```

Notes:

- `check-runs` lists the **latest** attempt for each check name, so a leg
  that was re-run green passes.
- Runs are sorted newest-first (by `id`; a queued run has no `started_at`).
  A SHA that carries both a PR-suite run and a push-suite run with the same
  name is judged by the newest one.
- Legs that plan 062 marks experimental are deliberately not in `REQUIRED`.
  When a leg becomes required in plan 064's ruleset, add its exact name here
  too. A maintenance note says so.

### Step 2: Atomic push

Change the push line to:

```bash
git push --atomic origin main --follow-tags
```

With `--atomic`, either the `main` update and the new tag are both accepted,
or neither is. A ruleset rejection of `main` then cannot leave an orphan tag
for the publish jobs to release.

### Step 3: Stop interpolating `inputs.bump` into the script

In `Determine version`, add `BUMP: ${{ inputs.bump }}` to its `env:` block
(next to `CUSTOM_VERSION`), and change `case "${{ inputs.bump }}" in` to
`case "$BUMP" in`.

**Verify (steps 1–3)**: `npx prettier --check .github/workflows/release.yml`
→ exit 0 (fix with `--write` if needed). If `actionlint` is installed, it
reports nothing. `grep -n '\${{ inputs.bump }}' .github/workflows/release.yml`
→ exactly 1 match, the `env:` line.

### Step 4: Test the gate script against real history (no release)

Extract the committed step's `run:` body into a scratch file outside the
repo (so you test exactly what you committed), then run it in Git Bash with
real values:

```bash
cd /c/filesystem-mcp
node -e "const Y=require('yaml');const s=Y.parse(require('fs').readFileSync('.github/workflows/release.yml','utf8')).jobs.release.steps.find(s=>s.name==='Require green CI for this commit');require('fs').writeFileSync(process.argv[1],s.run)" "$TEMP/gate.sh"
export GITHUB_REPOSITORY=j0hanz/filesystem-mcp
export REQUIRED='Check (ubuntu-latest)|Check (windows-latest)|Release build paths'
# A green commit (the v2.7.6 release commit's parent; CI was green):
GITHUB_SHA=$(git rev-parse 36950a81) bash "$TEMP/gate.sh"; echo "exit=$?"
# A commit whose ubuntu leg failed on attempt 1 and was re-run green:
GITHUB_SHA=$(git rev-parse b1d96f99) bash "$TEMP/gate.sh"; echo "exit=$?"
# A commit whose CI was cancelled (concurrency) and never completed:
GITHUB_SHA=$(git rev-parse c75c33c3) bash "$TEMP/gate.sh"; echo "exit=$?"
```

`gh` uses your local auth, so `GH_TOKEN` is not needed locally. These three
results were confirmed by the advisor at planning time (0 / 0 / 1;
`c75c33c3` fails on `'Check (windows-latest)' concluded cancelled`).

**Verify**:

- `36950a81` → three `ok:` lines, `exit=0`.
- `b1d96f99` → `exit=0` (the re-run counts).
- `c75c33c3` → `exit=1`, with an error naming a non-success conclusion
  (`cancelled`) or a missing run.

If any result differs, STOP and report the `check-runs` output for that SHA.
Delete the scratch file afterwards.

## Test plan

- Step 4 exercises the gate's three outcomes (green, re-run green,
  cancelled) against real GitHub data, without dispatching a release.
- The atomic push and the env-var change are verified by reading the diff.
  The first real release after merge is their end-to-end test. Watch its log
  for `ok:` lines.

## Done criteria

- [ ] `grep -n "Require green CI for this commit" .github/workflows/release.yml` → 1 match, after `Require dispatch on main`
- [ ] `grep -n "checks: read" .github/workflows/release.yml` → 1 match, in the `release` job
- [ ] `grep -n "git push --atomic origin main --follow-tags" .github/workflows/release.yml` → 1 match
- [ ] `grep -c '\${{ inputs.bump }}' .github/workflows/release.yml` → 1
- [ ] Step 4's three runs gave exit 0 / 0 / 1
- [ ] `npx prettier --check .` exits 0
- [ ] `git diff --name-only main...HEAD` → only `.github/workflows/release.yml` (and `plans/README.md` if committed)

## STOP conditions

Stop and report back (do not improvise) if:

- Step 4's green commit fails the gate. The check names differ from
  `REQUIRED`, so report the names `check-runs` returns.
- `check-runs` returns more than 100 runs for one commit (check with
  `gh api "repos/j0hanz/filesystem-mcp/commits/$(git rev-parse 36950a81)/check-runs?per_page=1" --jq .total_count`;
  8 at planning: 3 CI and 5 Release jobs). Pagination would
  be needed, so report it.
- The drift check shows `release.yml` restructured (for example, the push
  moved out of the `release` job).

## Maintenance notes

- `REQUIRED` must list the same names as plan 064's ruleset required checks.
  When a leg is promoted (plan 062's macOS / Node 26), update both.
- If a check is ever renamed in `ci.yml`, releases stop with "No '<name>'
  check run". That is the intended failure: fix `REQUIRED` in the same change
  as the rename.
- Release commits (`release: v…`) are pushed with `GITHUB_TOKEN`, which
  triggers no workflows, so they have **no** CI check runs (verified:
  `3da494ae` has 0). Dispatching a release while `main`'s tip is still the
  previous release commit (no new commits since) therefore fails with "No
  'Check (ubuntu-latest)' check run". That is intended, because there is
  nothing new to release.
- Emergency release with CI unavailable: no bypass input exists on purpose.
  Re-run CI, or dispatch from a commit that has green CI.
