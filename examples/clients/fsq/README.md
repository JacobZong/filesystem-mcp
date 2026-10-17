# fsq

Call any filesystem-mcp tool from your shell, with text output for people
and `--json` for scripts and `jq`. fsq starts the server over stdio, or uses
one already running over HTTP. A script or a CI job then works on the
workspace under the same limits as an AI assistant: it sees only the allowed
folders and no secret files. An overwrite waits for an answer. An abridged
session:

```text
$ node fsq.ts search_text searchPattern=TODO context=1
src/app.ts-11- export function load() {
src/app.ts:12:   // TODO: cache this
src/app.ts-13-   return read();

$ node fsq.ts find_files pattern='**/*.test.ts' --all --json | jq -r '.results[].path'
src/app.test.ts
src/util.test.ts

$ node fsq.ts create files='[{"path":"notes.md","content":"# Notes\n"}]'
? "/home/me/proj/notes.md" already exists. Overwrite it?
  1) overwrite
  2) skip
number: 2
{"files":[],"skipped":["notes.md"]}
```

## Run

Requires Node 24+.

```sh
npm install
node fsq.ts [options] <command> [args...]
```

| Command                | What it does                                                        |
| :--------------------- | :------------------------------------------------------------------ |
| `tools`                | Lists the tools; `✎` marks the ones that change files               |
| `help [topic]`         | Prints the server's usage guide, or one section of it               |
| `complete <partial>`   | Completes a path, like tab completion; empty lists the roots        |
| `<tool> key=value ...` | Calls a tool. Values are parsed as JSON when they can be, else text |
| `<tool> '<json>'`      | Calls a tool with one JSON object of arguments                      |

| Option           | What it does                                                                  |
| :--------------- | :---------------------------------------------------------------------------- |
| `--dir <dir>`    | Starts filesystem-mcp over stdio with `<dir>` as its root. Default `.`        |
| `--read-only`    | Starts it with `--read-only`: the tools that change files are not registered  |
| `--url <url>`    | Uses a running server over HTTP instead. `FS_API_KEY` is sent as bearer token |
| `--legacy`       | Speaks the 2025 protocol instead of negotiating 2026-07-28                    |
| `--json`         | Prints the result's data as JSON instead of its text                          |
| `--all`          | Follows `nextCursor` and prints every page                                    |
| `--timeout <ms>` | Gives up after this long without progress. Default 60000                      |

A value that should stay a string but looks like JSON needs JSON quotes:
`path='"123"'`. `FS_MCP_BIN` points fsq at a local `dist/index.js` instead of
the npm package.

Exit codes: `0` success; `1` the call failed, or a batch call failed for some
of its paths; `2` usage, connection, or protocol error; `130` cancelled with
Ctrl+C.

The server's confirmations (overwrites, recursive deletes, access to folders
outside the roots) are asked on stderr and answered on stdin. When stdin is
closed (`< /dev/null`, most CI runners) every confirmation is declined, so an
unattended run cannot overwrite a file or widen its own access.

Against a shared server:

```sh
FS_API_KEY="$(openssl rand -hex 24)" npx -y @j0hanz/filesystem-mcp --port 3000 ~/code/app &
FS_API_KEY=... node fsq.ts --url http://127.0.0.1:3000/mcp read path="$HOME/code/app/README.md" head=20
```

Over HTTP, prefer absolute paths: a relative path resolves against the
server's root only when the server was started outside it.

## How it works

Each part maps to one piece of the MCP client API:

- **Transports.** `--dir` uses `StdioClientTransport` with `cwd: <dir>`, so
  relative paths resolve inside the workspace. `--url` uses
  `StreamableHTTPClientTransport` with
  `authProvider: { token: async () => FS_API_KEY }`.
- **Protocol era.** `versionNegotiation: { mode: 'auto' }` connects with the
  2026-07-28 revision. `--legacy` leaves it out, which is the plain 2025
  `initialize` handshake. Over stdio both eras can confirm; over HTTP a 2025
  client cannot, and the server answers with an error that says so.
- **Where the data is.** Tools that write their own text (`read`, `list`,
  `find_files`, `search_text`, `diff`, `edit`, `patch`, `replace_text`,
  `move`, `delete`) put their machine-readable data in `_meta`; `stat`,
  `create`, and `list_roots` use `structuredContent`. `--json` prints
  `structuredContent ?? _meta` without the `io.modelcontextprotocol/` keys.
  `read --json` prints the metadata; the file's text is the text output.
- **Pagination.** A paged result has `_meta.nextCursor`. `--all` repeats the
  call with the same arguments plus `cursor` until there is none, and merges
  the pages' arrays (`results`, `matches`, `entries`). Cursors expire after
  about 60 seconds.
- **Partial failure.** `isError` is set only when every path in a batch
  failed. A batch that failed part-way reports it in `summary.failed` (`read`,
  `stat`, `edit`, `delete`, `replace_text`) or in `failures` (`create`,
  `move`); fsq exits 1 for both.
- **Progress and cancellation.** Passing `onprogress` is what asks the server
  for `notifications/progress`; fsq shows the latest message on stderr, and
  `resetTimeoutOnProgress` keeps a long scan alive. Ctrl+C aborts the call's
  `AbortSignal`, which sends `notifications/cancelled` to the server.
- **Confirmations.** The client declares `elicitation: { form: {} }` and
  handles `elicitation/create`. The server's forms have one field: a boolean,
  an enum, or an array of enum values when it asks to grant several folders
  at once.
- **Completions and prompts.** `complete` is `client.complete()` on the
  `filesystem-mcp://file/{+path}` resource template; values are
  percent-encoded with `/` kept. `help` is the `get-help` prompt, fetched
  with `client.getPrompt()`.

## Check

`npm test` runs `check.ts`: the real CLI against the built server, over stdio
and over HTTP with an API key. No network needed. Build the server first with
`npm run build` at the repository root.
