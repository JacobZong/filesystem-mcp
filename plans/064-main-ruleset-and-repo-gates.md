# Plan 064: `main` requires green CI to merge, agent PRs get CI without manual approval, and CodeQL scans every PR

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **This plan changes GitHub repository settings, not files.** Every
> `gh api -X POST/PATCH/PUT` below is an outward-facing change on a public
> repository. Get the operator's explicit go-ahead before step 2. Run each
> call with the operator's own `gh` login, which must have admin access.
>
> **Drift check (run first)**:
> `gh api repos/j0hanz/filesystem-mcp/rulesets` → expected `[]`, and
> `gh api repos/j0hanz/filesystem-mcp/branches/main/protection` → expected
> HTTP 404 "Branch not protected". If either already returns a configuration,
> STOP and report it.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: MED. A wrong bypass list can block the Release workflow's push
  to `main`. Plan 063's atomic push makes that failure safe: no orphan tag,
  nothing published. Step 2 says how to verify the bypass.
- **Depends on**: plan 055 (stable check names, every `main` commit gets CI)
  and plan 063 (atomic release push). Run this after both have merged.
- **Category**: dx
- **Planned at**: commit `3da494ae`, 2026-10-12

## Why this matters

`main` has **no branch protection and no rulesets**. The CI checks are
advisory:

- **PR #53** (`copilot/fix-stringified-arguments-issue`) changed
  `src/core/schema.ts`, `src/tools/define.ts`, `src/tools/edit.ts` and tests.
  It was merged on 2026-10-06 with **zero CI check runs**. Its CI was waiting
  for approval (`action_required`) and flipped to "failure" at the moment of
  the merge. PR #58 merged the same way. PR #30 was merged before its check
  finished.
- Runs triggered by the Copilot actor sit in `action_required` with 0 jobs:
  runs 38132376598, 38133619399 and 38134346843 on PR #59. The ~47 h and
  ~100 min CI "failures" in the history (37451514685, 38217346901, …) are
  these never-started runs, closed when the PR merged or closed. They were
  not hangs, and the "workflow file issue" label on them is misleading.
- CodeQL is "not-configured" (`gh api …/code-scanning/default-setup`), and
  nothing lints the two workflow files. This repo is a security-boundary
  product (a filesystem sandbox) and receives AI-authored PRs. CodeQL default
  setup is free for public repositories and covers both JS/TS taint analysis
  and GitHub Actions workflow injection.

The operator's choice, recorded on 2026-10-12, is that **the repository admin
keeps an "always" bypass**. Direct pushes by the owner continue to work, and
plan 063 gates what gets **released** from those pushes. What this plan
enforces is that **nobody else**, including AI agents with write access, can
land on `main` without green CI.

## Current state

- `gh api repos/j0hanz/filesystem-mcp/rulesets` → `[]`;
  `…/branches/main/protection` → 404. Repo owner type: **User**. Merge queue
  is unavailable for user-owned repos.
- CI check names on every `push` and `pull_request` (after plan 055, which
  does not rename them):
  `Check (ubuntu-latest)`, `Check (windows-latest)`, `Release build paths`.
  Plan 062 adds `Check (macos-latest)` and `Check (ubuntu-latest, node 26)`.
  They stay **non-required** until they have been green for a while.
- `.github/workflows/release.yml` `Commit, tag & push` pushes to `main` with
  the workflow's `GITHUB_TOKEN`:
  `git push --atomic origin main --follow-tags` (after plan 063). The
  ruleset must let that push through.
- The GitHub Actions app's integration ID is `15368`. It is the
  `integration_id` of check runs created by Actions, and it is the actor to
  try as a bypass for the release push. **Whether a user-owned repository
  accepts it as a ruleset bypass actor was not verified at planning.** Step 2
  checks it, and a fallback follows.
- The `RepositoryRole` actor ID for **admin** is `5`.
- `.github/workflows/ci.yml` has `permissions: contents: read` and references
  no secrets, so running it without approval for agent PRs exposes nothing.

## Commands you will need

| Purpose       | Command                                                                                      | Expected on success                    |
| ------------- | -------------------------------------------------------------------------------------------- | -------------------------------------- |
| Auth check    | `gh auth status` and `gh api repos/j0hanz/filesystem-mcp --jq .permissions.admin`            | `true`                                 |
| List rulesets | `gh api repos/j0hanz/filesystem-mcp/rulesets`                                                | JSON array                             |
| CodeQL state  | `gh api repos/j0hanz/filesystem-mcp/code-scanning/default-setup --jq .state`                 | `configured`                           |
| Check names   | `gh api repos/j0hanz/filesystem-mcp/commits/<full sha>/check-runs --jq '.check_runs[].name'` | the 3 names (use a non-release commit) |

## Scope

**In scope** (settings via `gh api` or the web UI):

- One repository ruleset on the default branch.
- The Copilot cloud agent's "Require approval for workflow runs" setting.
- CodeQL default setup.
- `.github/workflows/ci.yml`: one comment line at the top (step 3)
- `plans/README.md`: status row, plus the ruleset ID

**Out of scope**:

- Requiring reviews, CODEOWNERS, signed commits, linear history: none was
  asked for, and the owner works solo.
- Making plan 062's new legs required (they stay experimental at first).
- Changing `release.yml` beyond plan 063. If the bypass fails (step 2), the
  deploy-key fallback is a separate, operator-approved change. STOP and
  report.
- Dependabot (previously rejected: it fights the deliberate exact SDK pins).

## Git workflow

- Branch: `advisor/064-main-ruleset-and-repo-gates`, only for the one-line
  `ci.yml` comment and the README row.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the preconditions

Run these in Git Bash. Start with `git fetch origin`.

1. `gh api repos/j0hanz/filesystem-mcp --jq .permissions.admin` → `true`.
2. Take the newest `main` commit that is **not** a `release: v…` commit
   (release commits are pushed with `GITHUB_TOKEN`, which triggers no
   workflows, so they never have CI check runs):
   `sha=$(git log origin/main -n1 --format=%H --invert-grep --grep='^release: v')`
   then
   `gh api repos/j0hanz/filesystem-mcp/commits/$sha/check-runs --jq '.check_runs[] | [.name, .app.id] | @tsv'`
   → it includes the three required names, each with app id `15368`.
   At planning time, `36950a81` returned all three with `15368`.
3. Plans 063 and 055 are on `origin/main`:
   (a) `git show origin/main:.github/workflows/release.yml | grep -c 'git push --atomic origin main --follow-tags'` → `1`;
   (b) `git show origin/main:.github/workflows/ci.yml | grep -c "github.event_name == 'pull_request' && 'pr' || github.sha"` → `1`.

**Verify**: all hold. If 3a or 3b gives 0, STOP: without the atomic push, a
bypass misconfiguration can publish an orphan tag, and without 055 not every
`main` commit has a CI result.

### Step 2: Create the ruleset

Write this JSON to a temp file **outside the repo**: `$TEMP/ruleset.json` in
Git Bash, or `$env:TEMP\ruleset.json` in PowerShell (then pass that path to
`--input`):

```json
{
  "name": "main: green CI required",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [
    { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" },
    { "actor_id": 15368, "actor_type": "Integration", "bypass_mode": "always" }
  ],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [
          { "context": "Check (ubuntu-latest)", "integration_id": 15368 },
          { "context": "Check (windows-latest)", "integration_id": 15368 },
          { "context": "Release build paths", "integration_id": 15368 }
        ]
      }
    }
  ]
}
```

Why each part:

- **Admin `always` bypass**: the operator's choice. Owner pushes and merges
  keep working.
- **Integration 15368 `always`**: lets the Release workflow's `GITHUB_TOKEN`
  push the version-bump commit.
- **`pull_request` with 0 approvals**: anyone without bypass must land
  through a PR. Copilot and other agents push branches, never `main`.
- **`strict` off**: a PR need not be rebased on the latest `main` before
  merging. With a solo maintainer and a 2-minute CI, strict mode is friction
  for little gain.

Create it:

```bash
gh api -X POST repos/j0hanz/filesystem-mcp/rulesets --input "$TEMP/ruleset.json"
```

- **HTTP 201**: record the returned `id`.
- **HTTP 422 naming the Integration bypass actor**: do not retry, and do
  not drop the entry and create the ruleset anyway. STOP and report. The
  fallback is a deploy key (the operator creates
  a write deploy key, stores the private key as the secret
  `RELEASE_DEPLOY_KEY`, `release.yml`'s checkout uses
  `ssh-key: ${{ secrets.RELEASE_DEPLOY_KEY }}`, and the ruleset bypasses
  `{ "actor_type": "DeployKey", "bypass_mode": "always" }`). That needs the
  operator's secret and a `release.yml` change, so it is a separate decision.

**Verify**:
`gh api repos/j0hanz/filesystem-mcp/rulesets/<id> --jq '{enforcement, bypass: [.bypass_actors[].actor_type], checks: [.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context]}'`
→ enforcement `active`, both bypass actors, the three contexts.

If `bypass` does not list both `RepositoryRole` and `Integration` (the API
dropped one silently), disable the ruleset at once:
`gh api -X PUT repos/j0hanz/filesystem-mcp/rulesets/<id> -f enforcement=disabled`,
confirm `gh api repos/j0hanz/filesystem-mcp/rulesets/<id> --jq .enforcement`
→ `disabled`, then STOP and report.

### Step 3: Let agent PRs run CI without approval

This setting is in the web UI. Ask the operator to do it, or do it with the
operator's browser session:

**Settings → Copilot → Cloud agent** (the label may read "Coding agent") →
clear **"Require approval for workflow runs"** (GitHub changelog
2026-03-13). If the setting is not there, STOP and report what the page shows.

Then add one line at the very top of `.github/workflows/ci.yml`, above
`name: CI`:

```yaml
# Runs on agent PRs without manual approval: keep this workflow secret-free and contents:read.
```

**Verify**: `npx prettier --check .github/workflows/ci.yml` → exit 0. After
the next Copilot-authored PR push, `gh run list --workflow CI --limit 5 --json conclusion,event,headBranch`
shows a `pull_request` run that is not `action_required` (check it later and
record the result in the README).

### Step 4: Turn on CodeQL default setup

```bash
gh api -X PATCH repos/j0hanz/filesystem-mcp/code-scanning/default-setup \
  -f state=configured -f query_suite=default \
  -f 'languages[]=javascript-typescript' -f 'languages[]=actions'
```

**Verify**: poll `gh api repos/j0hanz/filesystem-mcp/code-scanning/analyses --jq 'length'`
until it is ≥ 1. Then
`gh api repos/j0hanz/filesystem-mcp/code-scanning/default-setup --jq '{state, languages}'`
→ `state` is `configured` and `languages` contains both
`javascript-typescript` and `actions` (aliases such as `javascript` /
`typescript` may also appear). List the alerts:

```bash
gh api --paginate repos/j0hanz/filesystem-mcp/code-scanning/alerts \
  --jq '.[] | [.number, .rule.id, (.rule.security_severity_level // .rule.severity), .most_recent_instance.location.path] | @tsv'
```

Copy each row (number, rule, severity, path) as a bullet under a
`- 064 CodeQL first scan:` line at the end of the `### Batch 055–064`
section of `plans/README.md`. Do not fix anything here. Each real alert is a
candidate plan. If an `actions/code-injection` alert on
`.github/workflows/release.yml` appears, record it and report it, since
plan 063 should have removed that pattern.

Do **not** add CodeQL to the required checks yet. Record that as a
maintenance note.

### Step 5: Prove the gate works on a PR

Ask the operator for a throwaway PR (for example, a one-word change in
`docs/`). Right after it is opened (retry while it reads `UNKNOWN`):

`gh pr view <n> --json mergeStateStatus --jq .mergeStateStatus` → `BLOCKED`
(as a non-bypass actor, the PR cannot merge before the required checks pass).
As admin, the operator sees the "bypass" merge option. That is expected.

Then run `gh pr checks <n> --watch` until every check completes, and read
`mergeStateStatus` again. Expect `CLEAN`, or `UNSTABLE` if the only
non-green checks are non-required ones (CodeQL, plan 062's experimental
legs). Any value other than `BLOCKED` after the three required checks pass
means the gate works. Close the PR without merging and delete its branch.

**Verify**: `BLOCKED` first, then `CLEAN` or `UNSTABLE`. Record both values
in the README bullet for 064.

### Step 6: The first release after this plan

The bypass for the release push is proven only by a real release. Ask the
operator to check the next Release run's `Commit, tag & push` step:

- If it succeeds, record "release push bypass verified" in the README.
- If it fails with a ruleset rejection, no tag was pushed (atomic) and
  nothing was published (later jobs `needs: release`). Disable the ruleset as
  an interim fix
  (`gh api -X PUT repos/j0hanz/filesystem-mcp/rulesets/<id> -f enforcement=disabled`),
  report it and STOP. The deploy-key fallback (step 2) is a separate operator
  decision.

### Step 7: Commit the note and the comment

`npx prettier --write plans/README.md .github/workflows/ci.yml && npx prettier --check plans/README.md .github/workflows/ci.yml`
→ exit 0. Commit on `advisor/064-main-ruleset-and-repo-gates` with
`chore(ci): note agent-PR CI runs without approval; record 064 settings`.
Keep the `| 064 |` table cell short (status and ruleset id). Details go in
the `### Batch 055–064` bullets.

## Test plan

- Step 5 tests the merge gate. Step 6 tests the release bypass. Step 3's
  follow-up check tests the approval setting. There are no repository tests.

## Done criteria

- [ ] `gh api repos/j0hanz/filesystem-mcp/rulesets --jq 'length'` → `1`
- [ ] `gh api repos/j0hanz/filesystem-mcp/rulesets/<id> --jq '[.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context] | sort'` → `["Check (ubuntu-latest)","Check (windows-latest)","Release build paths"]`
- [ ] `gh api repos/j0hanz/filesystem-mcp/rulesets/<id> --jq '[.bypass_actors[] | [.actor_type, .actor_id, .bypass_mode]]'` → exactly `RepositoryRole 5 always` and `Integration 15368 always`
- [ ] `…/code-scanning/default-setup --jq .state` → `configured`
- [ ] The Copilot approval setting is cleared (operator confirmed), and the `ci.yml` comment is added
- [ ] Step 5 observed `BLOCKED`, then `CLEAN` or `UNSTABLE`
- [ ] `plans/README.md`: the 064 row has the ruleset id; the batch section has the CodeQL first-scan bullets

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check finds an existing ruleset or branch protection.
- Plan 063 has not merged (no `--atomic` on `origin/main`).
- The ruleset API rejects the Integration bypass (step 2). Do not create a
  ruleset that would block releases.
- The Copilot approval setting does not exist where step 3 says.
- The first scan raises a **critical** or **high** CodeQL alert in `src/`.
  Report it right away. It may be a live sandbox issue.

## Maintenance notes

- **The required check names live in three places** and must change
  together: this ruleset, `REQUIRED` in `release.yml` (plan 063), and the
  job names in `ci.yml`.
- When plan 062's legs are promoted, add `Check (macos-latest)` and
  `Check (ubuntu-latest, node 26)` to the ruleset (`gh api -X PUT …/rulesets/<id>`
  with the full JSON) and to `REQUIRED`.
- Once CodeQL has run on about 10 PRs without noise, consider a
  `code_scanning` rule (alerts at "high" or above block merges) in the
  ruleset.
- The admin bypass means the owner's direct pushes skip the gate. Plan 063
  still stops a release from such a commit until its CI is green. If direct
  pushes ever break `main` regularly, change the admin `bypass_mode` to
  `pull_request` (the owner then merges through PRs but may override checks).
