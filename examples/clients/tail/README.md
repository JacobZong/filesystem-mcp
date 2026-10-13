# tail

`tail -f` through filesystem-mcp: print the last lines of one or more files,
then each new line as it is written. Point it at a server running over HTTP
to follow a log on another machine without a shell there. Only files inside
that server's roots can be read, and secret files stay blocked. An abridged
session:

```text
$ node tail.ts logs/app.log logs/worker.log -n 2
==> /srv/app/logs/app.log <==
12:00:01 GET /health 200
12:00:04 GET /api/items 200

==> /srv/app/logs/worker.log <==
12:00:02 job 41 done

==> /srv/app/logs/app.log <==
12:00:09 POST /api/items 201
```

## Run

Requires Node 24+.

```sh
npm install
node tail.ts <file...> [-n 10] [--url <url>] [--legacy]
```

| Option        | What it does                                                                   |
| :------------ | :----------------------------------------------------------------------------- |
| `-n <lines>`  | Lines to print from the end of each file first. Default 10                     |
| `--url <url>` | Follows files on a running server over HTTP; paths are absolute on that server |
| `--legacy`    | Speaks the 2025 protocol instead of negotiating 2026-07-28                     |

Without `--url`, tail starts filesystem-mcp over stdio with each file's folder
as a root. With `--url`, `FS_API_KEY` is sent as the bearer token:

```sh
FS_API_KEY=... npx -y @j0hanz/filesystem-mcp --read-only --port 3000 /srv/app/logs
FS_API_KEY=... node tail.ts --url http://127.0.0.1:3000/mcp /srv/app/logs/app.log
```

Ctrl+C exits. `FS_MCP_BIN` points tail at a local `dist/index.js` instead of
the npm package.

## How it works

tail uses no tools at all: each file is a resource. Each part maps to one
piece of the MCP client API:

- **Resource URIs.** A file is `filesystem-mcp://file/{+path}`, with the
  absolute path percent-encoded and `/` kept. The update notifications carry
  the same string, so it is the key for each file.
- **Subscribing, by era.** On 2026-07-28 (negotiated with
  `versionNegotiation`) one `client.listen({ resourceSubscriptions })` covers
  every file; `honoredFilter` says which ones the server is watching. On the
  2025 protocol it is one `client.subscribeResource()` per file. Either way
  changes arrive as `notifications/resources/updated` on the same handler.
  Over HTTP the server serves 2025 clients statelessly, so it has nowhere to
  send updates: `--legacy --url` is refused.
- **Subscribe, then read.** The subscription is opened before the first
  read, so a line written in between is in that read; a notification that
  lands while a read runs only causes one more read. Without that order, a
  write in the gap would sit unprinted until the next one.
- **Reading.** `client.readResource()` returns the whole file. tail prints
  what lies past the text it has already printed, up to the last newline; a
  half-written line waits for its newline. tail keeps that text, not just its
  length, because a file replaced by a rename over it can be just as long or
  longer. A file that no longer starts with it was truncated or replaced:
  tail says so on stderr and prints it from the start. A file that cannot be
  read was deleted or moved away; tail says so, and prints the file from the
  start when it reappears.
- **The cache.** The server marks file reads cacheable for 5 seconds, and the
  client SDK honors that. Right after a change notification the cached copy
  is exactly the stale one, so every read passes `cacheMode: 'bypass'`.
- **Reconnecting.** `McpSubscription.closed` resolves `'remote'` when the
  stream drops, for example when the HTTP server restarts. tail opens it
  again, retrying every second, then re-reads every file, so lines written
  while the server was down are printed too.

## Limits

Each change reads the whole file, and tail holds on to what it has printed of
each one, so tail suits logs up to a few megabytes; `read` with `startLine`
would fetch less, but a line range cannot say whether the file's last line is
complete yet, or whether the lines before it changed. Files over the server's
size limit (10 MiB by default) cannot be read as resources at all. Every file
must exist at startup: the server refuses to subscribe to a missing path. A
file deleted later stays followed and is picked up again when it reappears.

tail follows the path, not an open file, and compares each read only with
the text it printed. So a replacement that starts with exactly that text,
such as the old file copied with lines added, looks like an append: only the
added lines are printed, with no note on stderr. A file deleted and recreated
between two reads is judged the same way: tail only sees a deletion when a
read lands while the file is gone. And lines written after tail's last read
and before the file was truncated, moved away, or replaced are not printed:
by the next read they are no longer at the path.

## Check

`npm test` runs `check.ts`: the real app against the built server, over stdio
in both protocol eras and over HTTP, including truncation, replacement by a
rename (as long and longer), deletion, a half-written line, and a server
restart. No network needed. Build the server first with `npm run build` at
the repository root.
