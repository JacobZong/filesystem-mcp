#!/usr/bin/env bash
# Stage the built server, production node_modules, manifest and icon, boot the
# staged tree once with --version, then pack filesystem-mcp.mcpb at the repo
# root. Needs dev dependencies installed (tsc).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
cd "$root"

npm run build
cp -r dist package.json package-lock.json LICENSE README.md "$stage/"
cp mcpb/manifest.json "$stage/manifest.json"
cp assets/logo.png "$stage/icon.png"
(cd "$stage" && npm ci --omit=dev --ignore-scripts)

# Boot the production-only tree once: --version loads every runtime import, so a
# dependency that only resolves through devDependencies fails here, not for users.
node "$stage/dist/index.js" --version

npx -y @anthropic-ai/mcpb@2.1.2 pack "$stage" "$root/filesystem-mcp.mcpb"
