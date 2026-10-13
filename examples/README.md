# Example clients

Small, runnable apps that do all their file work through filesystem-mcp. Each
one is useful on its own and is a starting point for your own MCP client:
copy the folder, install its dependencies, and change what you need. The
[client guide](../docs/client-guide.md) explains the server's side of every
feature they use.

## Apps

| App                               | What it does                                                          | Run                                          |
| :-------------------------------- | :-------------------------------------------------------------------- | :------------------------------------------- |
| [fsq](clients/fsq/)               | Calls any tool from the shell; text for people, `--json` for scripts  | `node fsq.ts search_text searchPattern=TODO` |
| [browser](clients/browser/)       | Local web UI to browse, view, search, and edit a workspace            | `node server.ts <dir>`                       |
| [tail](clients/tail/)             | `tail -f` for files, locally or on a server reached over HTTP         | `node tail.ts <file...>`                     |
| [gatekeeper](clients/gatekeeper/) | Coding agent with a y/N/why gate on every file change                 | `node agent.ts <dir> --model <id>`           |
| [hooks](clients/hooks/)           | Runs a standing task through the model whenever the workspace changes | `node hooks.ts <dir> "<task>" --model <id>`  |
| [python](clients/python/)         | TODO/FIXME report for a workspace, with the Python SDK                | `python todo_report.py <dir>`                |

fsq, browser, tail, and python need no model or API key.

## What each app shows

| Feature                                                    | fsq | browser | tail | gatekeeper | hooks | python |
| :--------------------------------------------------------- | :-: | :-----: | :--: | :--------: | :---: | :----: |
| stdio transport, `cwd` set to the workspace                |  ✓  |    ✓    |  ✓   |     ✓      |   ✓   |   ✓    |
| Streamable HTTP with an API key                            |  ✓  |         |  ✓   |            |       |   ✓    |
| Both protocol eras (`--legacy`)                            |  ✓  |         |  ✓   |            |       |   ✓    |
| Tool data from `_meta` and `structuredContent`             |  ✓  |    ✓    |      |            |   ✓   |   ✓    |
| Pagination with `nextCursor`                               |  ✓  |    ✓    |      |            |       |   ✓    |
| Partial failures in batch results                          |  ✓  |    ✓    |      |            |       |   ✓    |
| Progress notifications and `resetTimeoutOnProgress`        |  ✓  |         |      |            |       |        |
| Cancelling a call with an `AbortSignal` (Ctrl+C)           |  ✓  |         |      |     ✓      |   ✓   |        |
| Confirmations through an `elicitation/create` handler      |  ✓  |         |      |     ✓      |   ✓   |   ✓    |
| Confirmations as data (manual `input_required`)            |     |    ✓    |      |            |       |        |
| Gating writes by annotations, with `dryRun` previews       |     |         |      |     ✓      |   ✓   |        |
| `--read-only`                                              |  ✓  |    ✓    |      |            |       |   ✓    |
| Resources: `resources/read` of files and images            |     |    ✓    |  ✓   |            |       |        |
| Resource subscriptions (`listen()`, `subscribeResource()`) |     |         |  ✓   |            |   ✓   |        |
| Completions on the file template                           |  ✓  |    ✓    |      |            |       |        |
| The `get-help` prompt and `internal://instructions`        |  ✓  |         |      |     ✓      |   ✓   |        |
| Tools passed to a model as functions                       |     |         |      |     ✓      |   ✓   |        |

## Prerequisites

- Node 24 or later. The TypeScript apps run as `node <file>.ts`, with no build
  step.
- For python: Python 3.10 or later, and `pip install -r requirements.txt`.
- For apps that use a model: [Ollama](https://ollama.com) with a
  tool-capable model, or an API key for one of the supported providers.

Each app starts the server with `npx -y @j0hanz/filesystem-mcp`. To run them
against a local build instead, run `npm run build` at the repository root and
set `FS_MCP_BIN` to the built `dist/index.js`.

## Model providers

Apps that call a model speak the OpenAI-compatible Chat Completions API over
`fetch`, with no vendor SDK. Pick a provider with `--provider`, or point
`LLM_BASE_URL` at any compatible host.

| `--provider` | Base URL                                                  | Key env var         | Tested  |
| :----------- | :-------------------------------------------------------- | :------------------ | :------ |
| `ollama`     | `http://localhost:11434/v1`                               | none                | yes     |
| `gemini`     | `https://generativelanguage.googleapis.com/v1beta/openai` | `GEMINI_API_KEY`    | yes     |
| `openai`     | `https://api.openai.com/v1`                               | `OPENAI_API_KEY`    | not yet |
| `anthropic`  | `https://api.anthropic.com/v1`                            | `ANTHROPIC_API_KEY` | not yet |

## Checks

Every app has a keyless end-to-end check that runs the real app against the
built server: `npm test` in a TypeScript app's folder, `python check.py` in
`clients/python/`. Build the server first with `npm run build` at the
repository root.
