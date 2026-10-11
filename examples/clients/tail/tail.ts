// tail: follow files through filesystem-mcp, like tail -f. Each file is a
// resource; the server says when it changed, and the app reads it again.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { McpSubscription, Transport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    lines: { type: 'string', short: 'n', default: '10' },
    url: { type: 'string' },
    legacy: { type: 'boolean', default: false },
  },
});
if (positionals.length === 0) {
  console.error(`usage: node tail.ts <file...> [-n 10] [--url <url>] [--legacy]

  Prints the last -n lines of each file, then new lines as they are written.
  --url follows files on a running server over HTTP (absolute paths, with
  FS_API_KEY as the bearer token); otherwise the server is started over stdio
  with each file's folder as a root. --legacy speaks the 2025 protocol.`);
  process.exit(2);
}
// Over stdio the files are local; over HTTP they are paths on the server's machine.
const files = values.url ? positionals : positionals.map((p) => resolve(p));

// The file template's {+path}: percent-encoded, with '/' kept.
const uriOf = (path: string): string =>
  `filesystem-mcp://file/${encodeURIComponent(path.replace(/\\/g, '/')).replace(/%2F/gi, '/')}`;

function transport(): Transport {
  if (values.url) {
    const key = process.env.FS_API_KEY;
    const auth = key ? { authProvider: { token: async () => key } } : {};
    return new StreamableHTTPClientTransport(new URL(values.url), auth);
  }
  const roots = [...new Set(files.map((file) => dirname(file)))];
  const bin = process.env.FS_MCP_BIN;
  return new StdioClientTransport({
    command: bin ? process.execPath : 'npx',
    args: bin ? [resolve(bin), ...roots] : ['-y', '@j0hanz/filesystem-mcp', ...roots],
    stderr: 'pipe',
  });
}

const client = new Client(
  { name: 'tail', version: '1.0.0' },
  values.legacy ? {} : { versionNegotiation: { mode: 'auto' } },
);
let closing = false;
client.onclose = () => {
  if (closing) return;
  console.error('tail: filesystem-mcp went away');
  process.exit(1);
};

// Per file: the text printed (or skipped by -n) so far, and whether a read is
// running. The text is kept, not just its length: a file replaced by one at
// least as long (a rename over it) only shows by no longer starting with it.
// That is one copy of the file, which every read fetches whole anyway.
// Busy from the start: a change that lands before the first read (the
// subscription comes first) only marks the file for one more read.
type Follow = { path: string; printed: string; busy: boolean; again: boolean; gone: boolean };
const byUri = new Map<string, Follow>(
  files.map((path) => [uriOf(path), { path, printed: '', busy: true, again: false, gone: false }]),
);
let lastHeader = '';

function print(follow: Follow, text: string): void {
  if (files.length > 1 && lastHeader !== follow.path) {
    process.stdout.write(`${lastHeader ? '\n' : ''}==> ${follow.path} <==\n`);
    lastHeader = follow.path;
  }
  process.stdout.write(text);
}

// Reads the whole file and prints what is new. Only complete lines are
// printed; a half-written last line waits for its newline. The server marks
// file reads cacheable for 5 s, and right after a change notification that
// cached copy is exactly the stale one, so the read bypasses the cache.
async function catchUp(uri: string, follow: Follow, first = false): Promise<void> {
  if (follow.busy && !first) return void (follow.again = true); // a burst is one read
  follow.busy = true;
  try {
    do {
      const initial = first;
      first = false;
      follow.again = false;
      let text: string;
      try {
        const { contents } = await client.readResource({ uri }, { cacheMode: 'bypass' });
        text = 'text' in contents[0] ? contents[0].text : '';
      } catch (error) {
        if (!follow.gone) console.error(`tail: ${follow.path}: ${(error as Error).message}`);
        follow.gone = true; // deleted or rotated away; a new file at the path is picked up
        follow.printed = '';
        continue;
      }
      if (follow.gone && !initial) console.error(`tail: ${follow.path}: file reappeared`);
      follow.gone = false;
      if (!text.startsWith(follow.printed)) {
        console.error(`tail: ${follow.path}: file truncated or replaced`);
        follow.printed = '';
      }
      const end = text.lastIndexOf('\n') + 1; // through the last complete line
      let from = follow.printed.length;
      if (initial) {
        const lines = text.slice(0, end).split('\n').slice(0, -1);
        const n = Number(values.lines);
        const kept = n > 0 ? lines.slice(-n) : [];
        // Counted per line with its newline, so an empty line still counts.
        from = end - kept.reduce((size, line) => size + line.length + 1, 0);
      }
      if (end > from) print(follow, text.slice(from, end));
      follow.printed = text.slice(0, end); // never shorter: it ended at a newline
    } while (follow.again);
  } finally {
    follow.busy = false;
  }
}

client.setNotificationHandler('notifications/resources/updated', ({ params }) => {
  const follow = byUri.get(params.uri);
  if (follow) void catchUp(params.uri, follow);
});

// 2026-07-28: one subscriptions/listen stream for every file. It can drop
// (an HTTP server restart); then it is opened again, retrying until the
// server is back, and the files re-read so nothing written meanwhile is lost.
async function listen(): Promise<void> {
  const sub: McpSubscription = await client.listen({ resourceSubscriptions: [...byUri.keys()] });
  for (const uri of byUri.keys()) {
    if (!sub.honoredFilter.resourceSubscriptions?.includes(uri)) {
      console.error(`tail: the server is not watching ${byUri.get(uri)!.path}`);
    }
  }
  stop = () => sub.close();
  void sub.closed.then(async (why) => {
    if (closing || why === 'local') return;
    console.error('tail: subscription dropped, reconnecting');
    for (;;) {
      await new Promise((ok) => setTimeout(ok, 1000));
      if (closing) return;
      try {
        await listen();
        break;
      } catch {
        // still down
      }
    }
    for (const [uri, follow] of byUri) void catchUp(uri, follow);
  });
}
let stop: () => Promise<unknown> = async () => {};

try {
  await client.connect(transport());
  // Subscribe, then read: a write between the two is in the read, and a
  // notification for it only causes one more read.
  if (client.getProtocolEra() === 'modern') {
    await listen();
  } else {
    // 2025 era: one resources/subscribe per file; updates arrive unsolicited.
    // Over HTTP the server serves 2025 clients statelessly: nothing to push on.
    for (const uri of byUri.keys()) {
      await client.subscribeResource({ uri }).catch((error: Error) => {
        const hint = values.url ? ' (a 2025-era client is only notified over stdio)' : '';
        throw new Error(`${error.message}${hint}`);
      });
    }
    stop = () => Promise.all([...byUri.keys()].map((uri) => client.unsubscribeResource({ uri })));
  }
  for (const [uri, follow] of byUri) await catchUp(uri, follow, true);
} catch (error) {
  console.error(`tail: ${(error as Error).message}`);
  closing = true;
  await client.close();
  process.exit(1);
}

process.on('SIGINT', () => {
  closing = true;
  void stop()
    .catch(() => {})
    .then(() => client.close())
    .then(() => process.exit(0));
});
