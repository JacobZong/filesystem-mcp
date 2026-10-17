# Plan 059: The Docker image and the staged MCPB bundle are booted before release, not only built

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 3da494ae..HEAD -- scripts/check-release-paths.sh scripts/pack-mcpb.sh Dockerfile src/index.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW. Two script lines that run in CI's `release-paths` job and
  before tagging.
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `3da494ae`, 2026-10-12

## Why this matters

The test suite, including `__tests__/dist-smoke.test.ts`, runs `dist/index.js`
from the repo checkout. There, `node_modules` holds **every devDependency**.
`@modelcontextprotocol/client` is one of them, at the same version as the
server SDK. Three release channels ship a production-only tree instead:

- The Docker image runs `npm prune --production` (`Dockerfile:17`).
- The MCPB bundle runs `npm ci --omit=dev` in a staging directory
  (`scripts/pack-mcpb.sh:15`).
- The npm package is installed without devDependencies.

A runtime import of a dev-only package, or a dependency moved to
`devDependencies` by mistake, passes every check and then crashes at start-up
for users of all three channels. `scripts/check-release-paths.sh` already
**builds** the image and the bundle, in CI and before tagging. It never
**runs** them.

`src/index.ts:13` statically imports `./transport.ts`, which pulls in the
whole runtime module graph. `src/` has no dynamic `import(` call (checked at
planning). So `--version` loads every runtime dependency before it prints, and
running `--version` on each artifact is enough to catch a missing runtime
module, at about a second of cost.

## Current state

- `scripts/check-release-paths.sh` (13 lines):

```bash
#!/usr/bin/env bash
# The release-only build paths, runnable anywhere without secrets: pack the
# desktop bundle, build the Smithery card in dry-run mode, and build the Docker
# image for the current arch. CI runs this on every push; the Release workflow
# runs it before it tags, so a broken path fails before a version exists.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

bash scripts/pack-mcpb.sh
node scripts/publish-smithery.mjs --dry-run
docker build --tag filesystem-mcp:release-check .
```

- `scripts/pack-mcpb.sh` (17 lines). The relevant tail:

```bash
npm run build
cp -r dist package.json package-lock.json LICENSE README.md "$stage/"
cp mcpb/manifest.json "$stage/manifest.json"
cp assets/logo.png "$stage/icon.png"
(cd "$stage" && npm ci --omit=dev --ignore-scripts)

npx -y @anthropic-ai/mcpb@2.1.2 pack "$stage" "$root/filesystem-mcp.mcpb"
```

- `Dockerfile`: the builder runs `npm ci --ignore-scripts`, `npm run build`,
  then `npm prune --production`. The release stage copies `dist`,
  `node_modules` and `package.json`, runs as user `mcp`, and has
  `ENTRYPOINT ["node", "dist/index.js"]`.
- `src/index.ts:10-13` imports `./cli.ts`, `./core/config.ts`,
  `./core/observability.ts` and `./transport.ts` statically. `src/cli.ts:121`
  defines `--version` / `-v`, and `:153` handles it.
- `__tests__/dist-smoke.test.ts` `DIST-002` already checks that `--version`
  prints the `package.json` version for the checkout's `dist/`.
- Where the script runs: `.github/workflows/ci.yml` job `release-paths`
  (Ubuntu, Docker available, `npm ci --ignore-scripts` first), and
  `.github/workflows/release.yml` step "Release-only build paths" before the
  tag is pushed.
- **The planning machine (Windows) has no `docker` in Git Bash.** The Docker
  half can only be verified where Docker exists: a Linux box, Docker Desktop,
  or CI.

## Commands you will need

| Purpose             | Command                                                       | Expected on success                         |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| Pack + boot bundle  | `bash scripts/pack-mcpb.sh`                                   | exit 0; prints the version; `.mcpb` written |
| Whole release paths | `bash scripts/check-release-paths.sh`                         | exit 0 (needs Docker)                       |
| Shell syntax        | `bash -n scripts/pack-mcpb.sh scripts/check-release-paths.sh` | exit 0                                      |
| Full check          | `npm run check`                                               | exit 0                                      |

## Scope

**In scope**:

- `scripts/pack-mcpb.sh`: one line before the `mcpb pack` line
- `scripts/check-release-paths.sh`: lines after `docker build`, plus its header comment
- `plans/README.md`: status row

**Out of scope**:

- `Dockerfile`, `mcpb/manifest.json`, `package.json`.
- An `npm pack` → install-from-tarball smoke test. Plan 046 deferred it as
  "worth it only if a packaging regression ships". The Docker and MCPB boots
  cover the prod-deps question for all three channels, since npm installs the
  same `dependencies` set.
- A full MCP `initialize` round-trip against the image. `--version` already
  loads the whole graph, and `DIST-003` covers the protocol on the same
  `dist/`.
- `.github/workflows/*.yml`. The script is already called in both places.

## Git workflow

- Branch: `advisor/059-boot-shipped-artifacts`
- One commit, e.g. `ci(release-paths): boot the docker image and staged bundle`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Boot the staged MCPB tree before packing

In `scripts/pack-mcpb.sh`, insert these lines between the `npm ci --omit=dev`
line and the `npx -y @anthropic-ai/mcpb…` line:

```bash
# Boot the production-only tree once: --version loads every runtime import, so a
# dependency that only resolves through devDependencies fails here, not for users.
node "$stage/dist/index.js" --version
```

Also change the header comment's first sentence to: "Stage the built server,
production node_modules, manifest and icon, boot the staged tree once with
--version, then pack filesystem-mcp.mcpb at the repo root."

**Verify**: `bash -n scripts/pack-mcpb.sh` → exit 0. Then
`bash scripts/pack-mcpb.sh` → exit 0. It prints the `package.json` version
(e.g. `2.7.6`) before the mcpb pack output, and `filesystem-mcp.mcpb` exists
at the repo root. Delete it afterwards: `rm filesystem-mcp.mcpb`, then
`test ! -e filesystem-mcp.mcpb && echo gone` → prints `gone`. The file is
gitignored, so `git status` does not show it either way.

### Step 2: Prove step 1 catches a dev-only import (temporary)

1. Temporarily insert `import '@modelcontextprotocol/client';` as a new
   line 1 of `src/core/config.ts`, above its header comment. The module has
   no imports today; its "zero imports" comment does not matter for this
   throwaway mutation. That package is a devDependency (`package-lock.json`
   marks it `dev: true`), so `npm ci --omit=dev` does not install it.
2. `bash scripts/pack-mcpb.sh` → must **fail**, with an
   `ERR_MODULE_NOT_FOUND` naming `@modelcontextprotocol/client`, at the
   `--version` line.
3. Revert: `git checkout -- src/core/config.ts`. Then run `npm run build` to
   refresh `dist/`.

**Verify**: step 2.2 failed as described, `git status --short src/` is
empty, and `node dist/index.js --version` prints the `package.json` version
with exit 0 (the rebuilt `dist/` is clean again).

### Step 3: Run the built image

In `scripts/check-release-paths.sh`, after the `docker build` line, add:

```bash
# Run the image once: it carries only production node_modules (npm prune
# --production), so this is where a dev-only runtime import would surface.
docker run --rm filesystem-mcp:release-check --version
```

Update the header comment's first sentence to say the script also boots the
bundle and the image. For example: "…pack and boot the desktop bundle, build
the Smithery card in dry-run mode, and build and boot the Docker image for
the current arch."

**Verify**: `bash -n scripts/check-release-paths.sh` → exit 0.

- If Docker is available locally (`docker version` succeeds), run
  `bash scripts/check-release-paths.sh` → exit 0, with the version printed
  twice (bundle, then image).
- If Docker is not available, say so in your report. The CI `release-paths`
  job is the verification for this half once the operator pushes the branch.
  It must print the version twice.

### Step 4: Full check

**Verify**: `npm run check` → exit 0 (unaffected, which confirms nothing else
moved).

## Test plan

- No new test files. Step 2 is the mutation test for the bundle boot. The
  image boot uses the same mechanism and is exercised by the CI
  `release-paths` job.

## Done criteria

- [ ] `grep -n 'node "\$stage/dist/index.js" --version' scripts/pack-mcpb.sh` → 1 match, on a line **before** the `mcpb@` line
- [ ] `grep -n "docker run --rm filesystem-mcp:release-check --version" scripts/check-release-paths.sh` → 1 match, after `docker build`
- [ ] `bash scripts/pack-mcpb.sh` exits 0 locally
- [ ] Step 2's mutation was observed to fail and was reverted
- [ ] `npm run check` exits 0
- [ ] `git diff --name-only main...HEAD` → only `scripts/check-release-paths.sh`, `scripts/pack-mcpb.sh` (and `plans/README.md` if committed), and `test ! -e filesystem-mcp.mcpb` succeeds
- [ ] `plans/README.md` status row updated, noting whether the Docker half was verified locally or awaits CI

## STOP conditions

Stop and report back (do not improvise) if:

- `node "$stage/dist/index.js" --version` fails on the **unmodified** tree.
  That is a real shipped-artifact bug today, so report the error.
- The staged tree prints a version different from `package.json`.
- `--version` turns out not to load `transport.ts`. That would show up as
  step 2 passing when it should fail. In that case the check is weaker than
  this plan assumes, so report it instead of switching to a protocol
  round-trip on your own.

## Maintenance notes

- If `src/index.ts` ever lazy-loads the transport (a dynamic `import()`),
  `--version` stops proving the runtime graph. These two lines must then
  become a real `initialize` request. `DIST-002` and this plan share that
  assumption.
- Booting the image with `--version` does not prove it can serve. If an
  image-only problem (user `mcp` permissions, a missing file in `COPY`) ever
  ships, extend the `docker run` to pipe one `initialize` line on stdin.
