# Contributing to Filesystem MCP

Thanks for helping. This guide takes you from a fresh clone to a pull request.

## Ways to help

- **Report a bug or suggest a feature** with the
  [issue templates](https://github.com/j0hanz/filesystem-mcp/issues/new/choose).
  Keep reports short, and remove secrets, private paths, and file contents
  from logs.
- **Improve the docs.** If something in the README or
  [configuration reference](docs/configuration.md) confused you, a fix is
  very welcome.
- **Pick up an issue.** Comment on it first so nobody duplicates the work.
- **Spread the word.** Star the repo, or suggest it for a list of MCP servers.

Report security problems privately. See [SECURITY.md](SECURITY.md).

## Setup

You need **Node.js 24 or later** (the version is in `.nvmrc`) and npm.

```bash
git clone https://github.com/YOUR_USERNAME/filesystem-mcp.git
cd filesystem-mcp
git remote add upstream https://github.com/j0hanz/filesystem-mcp.git
npm install
npm run build
```

## Run the server from source

```bash
npm run build
node dist/index.js /path/to/a/test/folder
```

The server speaks MCP over stdio, so it waits for a client. Two easy ways to
try it:

- **MCP Inspector**, a web UI for calling tools by hand:

  ```bash
  npx @modelcontextprotocol/inspector node dist/index.js /path/to/a/test/folder
  ```

- **Your own AI app.** Point it at your build instead of the npm package:

  ```json
  {
    "command": "node",
    "args": ["/absolute/path/to/filesystem-mcp/dist/index.js", "/path/to/a/test/folder"]
  }
  ```

`node dist/index.js --print-config /path` shows the resolved settings without
starting the server.

## Checks

| Command                | What it runs                                                      |
| :--------------------- | :---------------------------------------------------------------- |
| `npm run check`        | Everything CI runs: build, type checks, lint, format, knip, tests |
| `npm run fix`          | Formats and lint-fixes, then runs the full check                  |
| `npm run check:static` | Static checks only, no tests                                      |
| `npm test`             | Tests only, on Node's built-in test runner                        |

Pass test runner flags after `--`, for example
`npm test -- --test-name-pattern="resources"`.

`__tests__/dist-smoke.test.ts` starts the built `dist/index.js` and skips when
`dist/` is missing, so run `npm run build` (or `npm run check`) first.

CI runs `npm run check` on Ubuntu and Windows. Please run it before you open a
pull request.

## Project structure

```text
filesystem-mcp/
├── src/
│   ├── index.ts         Process entry point, shutdown, transport selection
│   ├── cli.ts           Argument parsing and --print-config
│   ├── cli-help.ts      --help and --version text
│   ├── server.ts        Server factory; wires tools, resources, and prompts
│   ├── instructions.ts  Usage guide sent to every client
│   ├── resources.ts     Resources, subscriptions, completion
│   ├── prompts.ts       Prompts
│   ├── transport.ts     Public entry re-exporting startServer / startHttpServer
│   ├── core/            Path guard, guarded filesystem, search, caches, watchers
│   ├── tools/           One file per tool, plus define.ts and batch.ts
│   └── transport/       stdio.ts, http.ts, http-policy.ts (auth, Origin, rate limit)
├── __tests__/           Test suites and shared helpers
├── docs/                Configuration reference, ADRs, and design notes
├── examples/            Runnable example MCP clients
├── mcpb/manifest.json   Claude Desktop extension manifest
├── scripts/             Release scripts (MCPB pack, Smithery publish)
└── Dockerfile           Multi-stage Alpine build, non-root user
```

Requests flow from `src/index.ts` to `src/transport/` (stdio or HTTP), then to
`src/server.ts`, the tool, resource, and prompt registrars, and finally
`src/core/`. Two classes do the security work: `PathGuard`
(`src/core/path.ts`) checks every path against the allowed folders and the
denylist, and `GuardedFileSystem` (`src/core/fs.ts`) is the guarded facade
tools use to read and write files.

## Adding or changing a tool

1. Each tool lives in its own file in `src/tools/` and is built with
   `defineTool` from `src/tools/define.ts`. Inputs are Zod schemas.
2. Set `readOnlyHint` honestly. It decides whether `--read-only` removes the
   tool and which annotations clients see.
3. Register it in `ALL_TOOLS` in `src/tools/index.ts`.
4. Read and write through the guarded filesystem, so `PathGuard` checks every
   path before the disk is touched.
5. Add tests in `__tests__/`, and add the tool to `mcpb/manifest.json`
   (a test checks that list).
6. Update the Tools table in `README.md`, and
   [docs/configuration.md](docs/configuration.md) if limits or options change.

Architecture decisions are recorded in [`docs/adr/`](docs/adr/). Read the
relevant one before changing the behavior it covers.

## Pull requests

1. Create a branch from `main`, for example `git checkout -b fix/search-crlf`.
2. Keep the change focused, with tests for new behavior or fixed bugs.
3. Run `npm run check`.
4. Push to your fork and open a pull request. The template asks for a summary,
   the related issue, and how you validated the change.

Checklist:

- [ ] `npm run check` passes locally
- [ ] Tests added or updated where it makes sense
- [ ] Docs updated if behavior, options, or limits changed
- [ ] Related issue linked (`Closes #123` only if the PR completes it)

**Commit messages** are free-form. Say what changed and why, and call out
breaking changes.

**Versions and releases.** Don't change the version in `package.json`,
`server.json`, or `mcpb/manifest.json`. The Release workflow bumps all three
together.

## Issues and the project board

Issues are the work items, and pull requests link to them. Labels: **bug**,
**enhancement**, **maintenance**, **documentation**, and **blocked**.
Maintainers track work on a GitHub Project; its setup and triage workflow are
in [docs/project-board.md](docs/project-board.md).
