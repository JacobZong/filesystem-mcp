# python: todo_report

filesystem-mcp from Python, with the official
[`mcp` SDK](https://pypi.org/project/mcp/). `todo_report.py` collects the
TODO, FIXME, HACK, and XXX comments in a workspace into a Markdown report,
grouped by tag. The server does the searching, so `.gitignore`d files,
`node_modules`, secret files such as `.env`, and anything outside the
workspace never show up. An abridged run:

```text
$ python todo_report.py ~/code/app
# TODO report

/home/me/code/app: 1 FIXME, 1 HACK, 12 TODO in 6 files.

## FIXME (1)

- `src/db.ts:42` retry on lost connection

## HACK (1)

- `src/build.py:7` pin until upstream fix (anna)
...
```

## Run

Requires Python 3.10+ and Node 24+ (the server is a Node program; `npx`
fetches it).

```sh
pip install -r requirements.txt
python todo_report.py [dir] [--out FILE] [--url URL] [--legacy]
```

| Option       | What it does                                                                 |
| :----------- | :--------------------------------------------------------------------------- |
| `dir`        | The folder to report on. Default `.`, or the server's only root with `--url` |
| `--out FILE` | Writes the report to `FILE`, relative to `dir`, instead of printing it       |
| `--url URL`  | Uses a running server over HTTP; `FS_API_KEY` is sent as the bearer token    |
| `--legacy`   | Speaks the 2025 protocol instead of negotiating 2026-07-28                   |

Without `--out` the server is started with `--read-only`, so a report run
cannot change anything. With `--out`, replacing an existing report is the
server's question: it is asked on stderr and answered on stdin, and closed
stdin declines. Declining or choosing `skip` keeps the old file and exits 1.
Over HTTP with `--legacy` the server cannot ask, so replacing a report fails
with an error instead. `FS_MCP_BIN` points the script at a local
`dist/index.js` instead of the npm package.

## How it works

Each part maps to one piece of the Python SDK:

- **Connecting.** `Client(...)` takes the transport. Over stdio it is
  `stdio_client()` with `StdioServerParameters`, whose `cwd` is the workspace
  so relative paths resolve inside it. Over HTTP it is
  `streamable_http_client()` with an `http_client` from
  `create_mcp_http_client(headers=...)`, which carries the API key. The
  client is used as `async with Client(...) as client`.
- **Paths over HTTP.** A running server resolves a relative path against its
  own working directory when that is inside a root, which the script cannot
  know. So with `--url` the script calls
  `list_roots` and resolves a missing or relative `dir`, and with it `--out`,
  against the root. If the server has no root or several, the script stops
  with an error asking for an absolute `dir`.
- **Protocol era.** The Python SDK's default `mode="auto"` negotiates the
  2026-07-28 revision and falls back to the 2025 handshake for older
  servers; `mode="legacy"` skips the probe. (The TypeScript SDK's default is
  the reverse: legacy unless you pass `versionNegotiation`.) The script
  behaves the same in both eras.
- **Searching.** One `search_text` call with an RE2 regex
  (`\b(FIXME|HACK|XXX|TODO)\b`, case-sensitive, so `todoList` does not
  match). The matches are in `result.meta`, the result's `_meta`: tools that
  print their own text keep their data there, while `stat`, `create`, and
  `list_roots` use `result.structured_content`.
- **Pagination.** While `meta["nextCursor"]` is set, the script repeats the
  call with the same arguments plus `cursor`. Each page has up to
  `maxResults` matches; cursors expire after about 60 seconds.
- **Markers.** A match is a whole line, so the script finds the markers in it.
  The first tag on a line always counts; a later one only when written as a
  marker (`TODO:` or `TODO(owner)`), so "remove this HACK" stays in the note.
  A note ends at the next marker or at a comment closer (`*/`, `-->`).
- **Confirmations.** `elicitation_callback=confirm` answers the server's
  forms. Each has one field: a boolean, an enum, or an array of enum values.
  On the 2026-07-28 era the SDK fulfils the server's `input_required` result
  through the same callback and retries the call, so the code is the same in
  both eras.
- **Errors.** A tool failure is `result.is_error`. A batch call that failed
  for some paths says so in its data (`failures` for `create`). Exiting from
  inside `async with Client(...)` surfaces as an exception group from the
  SDK's task groups, so the script returns its error and exits afterwards.

## Check

`python check.py` runs the real script against the built server, over stdio
in both protocol eras and over HTTP with an API key and one, two, or no roots,
on a workspace with more matches than fit on one page. No network needed.
Build the server first with `npm run build` at the repository root. Tested
with `mcp` 2.2.0 and 2.3.0.
