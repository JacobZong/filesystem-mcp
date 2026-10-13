// fsq: call any filesystem-mcp tool from the shell. Text for people, --json
// for scripts. Starts the server over stdio, or uses a running one over HTTP.
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { CallToolResult, Progress, Transport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';

const USAGE = `usage: node fsq.ts [options] <command> [args...]

commands:
  tools                 list the server's tools (✎ = changes files)
  help [topic]          the server's own usage guide (get-help prompt)
  complete <partial>    complete a path, like shell tab completion
  <tool> key=value ...  call a tool; each value is parsed as JSON, else kept as text
  <tool> '<json>'       call a tool with a JSON object of arguments

options:
  --dir <dir>     start filesystem-mcp over stdio with <dir> as its root (default: .)
  --read-only     start it with --read-only: no tool can change files
  --url <url>     use a running server over HTTP; FS_API_KEY is sent as a bearer token
  --legacy        speak the 2025 protocol instead of negotiating the newest
  --json          print the result's data as JSON instead of its text
  --all           follow nextCursor and print every page
  --timeout <ms>  give up after this long without progress (default 60000)

examples:
  node fsq.ts search_text searchPattern=TODO context=1
  node fsq.ts find_files pattern='**/*.ts' --all --json | jq -r '.results[].path'
  node fsq.ts edit path=a.js edits='[{"oldText":"var","newText":"let"}]' dryRun=true`;

// An unknown option or a missing value is a usage error (exit 2), not a crash.
const { values, positionals } = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        dir: { type: 'string', default: '.' },
        url: { type: 'string' },
        'read-only': { type: 'boolean', default: false },
        legacy: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        all: { type: 'boolean', default: false },
        timeout: { type: 'string', default: '60000' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    console.error(`fsq: ${(error as Error).message}\n${USAGE}`);
    process.exit(2);
  }
})();
const timeout = Number(values.timeout);
if (!(timeout > 0)) {
  console.error(`fsq: --timeout must be a number of milliseconds\n${USAGE}`);
  process.exit(2);
}
const [command, ...rest] = positionals;
if (!command || values.help) {
  console.error(USAGE);
  process.exit(command || values.help ? 0 : 2);
}

// `key=value` pairs, or one JSON object. A value that parses as JSON is used
// as JSON (numbers, booleans, arrays), anything else as a string.
function toolArgs(words: string[]): Record<string, unknown> {
  if (words.length === 1 && words[0].trimStart().startsWith('{')) return JSON.parse(words[0]);
  const args: Record<string, unknown> = {};
  for (const word of words) {
    const eq = word.indexOf('=');
    if (eq < 1) throw new Error(`expected key=value, got '${word}'`);
    const raw = word.slice(eq + 1);
    try {
      args[word.slice(0, eq)] = JSON.parse(raw);
    } catch {
      args[word.slice(0, eq)] = raw;
    }
  }
  return args;
}

function transport(): Transport {
  if (values.url) {
    const key = process.env.FS_API_KEY;
    const auth = key ? { authProvider: { token: async () => key } } : {};
    return new StreamableHTTPClientTransport(new URL(values.url), auth);
  }
  const dir = resolve(values.dir);
  const serverArgs = [...(values['read-only'] ? ['--read-only'] : []), dir];
  const bin = process.env.FS_MCP_BIN;
  return new StdioClientTransport({
    command: bin ? process.execPath : 'npx',
    args: bin ? [resolve(bin), ...serverArgs] : ['-y', '@j0hanz/filesystem-mcp', ...serverArgs],
    cwd: dir, // relative paths in tool calls resolve against the server's cwd
    stderr: 'pipe', // its startup banner is not our output
  });
}

const client = new Client(
  { name: 'fsq', version: '1.0.0' },
  {
    capabilities: { elicitation: { form: {} } },
    ...(values.legacy ? {} : { versionNegotiation: { mode: 'auto' } }),
  },
);

// Answers to the server's questions come from stdin; prompts go to stderr so
// stdout stays clean for pipes. Closed stdin (CI, `< /dev/null`) declines.
let lines: AsyncIterator<string> | undefined;
const controller = new AbortController();
async function ask(prompt: string): Promise<string | null> {
  if (!lines) {
    const rl = createInterface({ input: process.stdin, terminal: Boolean(process.stdin.isTTY) });
    rl.on('SIGINT', () => controller.abort()); // raw-mode terminals turn Ctrl+C into this
    lines = rl[Symbol.asyncIterator]();
  }
  process.stderr.write(prompt);
  const { value, done } = await lines.next();
  if (!process.stdin.isTTY) process.stderr.write(`${done ? '' : value}\n`); // echo piped answers
  return done ? null : value;
}

// Progress overwrites one stderr line; only a terminal can take that.
const clearLine = (): void => void (process.stderr.isTTY && process.stderr.write('\r\x1b[K'));

// The server asks before overwrites, recursive deletes, and access outside its
// roots. Each form has one field: a boolean, an enum, or (granting several
// directories at once) an array whose items are an enum.
client.setRequestHandler('elicitation/create', async ({ params }) => {
  if (params.mode === 'url') return { action: 'decline' };
  const fields = Object.entries(params.requestedSchema.properties);
  if (fields.length !== 1) return { action: 'decline' };
  const [key, field] = fields[0] as [string, { type?: string; enum?: string[]; items?: any }];
  clearLine();
  process.stderr.write(`? ${params.message}\n`);
  if (field.type === 'boolean') {
    const yes = (await ask('[y/N] '))?.trim().toLowerCase() === 'y';
    return yes ? { action: 'accept', content: { [key]: true } } : { action: 'decline' };
  }
  const options: string[] | undefined = field.enum ?? field.items?.enum;
  if (!options) return { action: 'decline' };
  options.forEach((option, n) => process.stderr.write(`  ${n + 1}) ${option}\n`));
  const many = field.type === 'array';
  const answer = await ask(many ? 'numbers, comma-separated: ' : 'number: ');
  const picked = (answer ?? '').split(',').flatMap((n) => options[Number(n) - 1] ?? []);
  if (picked.length === 0) return { action: 'decline' };
  return { action: 'accept', content: { [key]: many ? picked : picked[0] } };
});

// Tools that write their own text (read, list, search_text, edit, ...) carry
// their data in _meta; the rest (stat, create, list_roots) in
// structuredContent. Keys under io.modelcontextprotocol/ are protocol metadata.
function data(result: CallToolResult): Record<string, any> {
  const raw = result.structuredContent ?? result._meta ?? {};
  return Object.fromEntries(
    Object.entries(raw).filter(([key]) => !key.startsWith('io.modelcontextprotocol/')),
  );
}

function text(result: CallToolResult): string {
  return result.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

// The page trailer and list's "full tree at" link, which --all makes redundant.
const PAGER = /^(\/\/ showing \d+-\d+ of .*|full tree at filesystem-mcp:\/\/result\/\S+)$/;

const progress = (p: Progress): void => {
  if (process.stderr.isTTY && p.message) process.stderr.write(`\r\x1b[K${p.message}`);
};

async function call(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return (await client.callTool(
    { name, arguments: args },
    {
      signal: controller.signal,
      timeout,
      resetTimeoutOnProgress: true, // a long search that keeps reporting is alive
      onprogress: progress, // also what asks the server to send progress at all
    },
  )) as CallToolResult;
}

process.on('SIGINT', () => controller.abort());
let code = 0;
try {
  await client.connect(transport());
  if (command === 'tools') {
    const { tools } = await client.listTools();
    if (values.json) console.log(JSON.stringify(tools, null, 2));
    for (const tool of values.json ? [] : tools) {
      const mark = tool.annotations?.destructiveHint ? '✎' : ' ';
      console.log(`${mark} ${tool.name.padEnd(13)} ${tool.description?.split('. ')[0]}`);
    }
  } else if (command === 'help') {
    const topic = rest[0] ? { topic: rest[0] } : undefined;
    const prompt = await client.getPrompt({ name: 'get-help', arguments: topic });
    for (const m of prompt.messages) if (m.content.type === 'text') console.log(m.content.text);
  } else if (command === 'complete') {
    // The file resource template completes its {+path} variable: absolute, or
    // relative to the root (empty lists the roots). Both ends are
    // percent-encoded, '/' kept, as a URI template variable must be.
    const value = encodeURIComponent((rest[0] ?? '').replace(/\\/g, '/')).replace(/%2F/gi, '/');
    const { completion } = await client.complete({
      ref: { type: 'ref/resource', uri: 'filesystem-mcp://file/{+path}' },
      argument: { name: 'path', value },
    });
    for (const v of completion.values) console.log(decodeURIComponent(v));
    if (completion.hasMore) process.stderr.write(`(${completion.total} in all)\n`);
  } else {
    const args = toolArgs(rest);
    const pages = [await call(command, args)];
    while (values.all && !pages.at(-1)!.isError && data(pages.at(-1)!).nextCursor) {
      pages.push(await call(command, { ...args, cursor: data(pages.at(-1)!).nextCursor }));
    }
    clearLine();
    if (values.json) {
      // One object for the whole run: arrays (results, matches, entries) concatenate.
      const merged = data(pages[0]);
      for (const page of pages.slice(1)) {
        for (const [key, value] of Object.entries(data(page))) {
          merged[key] = Array.isArray(value) ? [...(merged[key] ?? []), ...value] : value;
        }
      }
      if (values.all) delete merged.nextCursor;
      console.log(JSON.stringify(merged, null, 2));
    } else {
      for (const page of pages) {
        const body = values.all
          ? text(page)
              .split('\n')
              .filter((l) => !PAGER.test(l))
          : [text(page)];
        console.log(body.join('\n').trimEnd());
      }
    }
    const last = data(pages.at(-1)!);
    if (!values.all && last.nextCursor) process.stderr.write('(more results: add --all)\n');
    // isError means every item failed; a batch can also fail part-way.
    const partial = pages.some((p) => data(p).summary?.failed > 0 || data(p).failures?.length > 0);
    code = pages.some((p) => p.isError) || partial ? 1 : 0;
  }
} catch (error) {
  clearLine();
  console.error(controller.signal.aborted ? 'cancelled' : `fsq: ${(error as Error).message}`);
  code = controller.signal.aborted ? 130 : 2;
} finally {
  await client.close();
  process.exit(code); // stdin may still hold the process open
}
