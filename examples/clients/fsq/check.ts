// Keyless end-to-end check: runs the real CLI against the built server, over
// stdio and over HTTP. Run `npm run build` at the repo root first.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = import.meta.dirname;
const serverBin = process.env.FS_MCP_BIN ?? resolve(here, '../../../dist/index.js');
type Run = { code: number | null; out: string; err: string };

function fsq(args: string[], opts: { stdin?: string; env?: object; node?: string[] } = {}) {
  const child = spawn(process.execPath, [...(opts.node ?? []), join(here, 'fsq.ts'), ...args], {
    env: { ...process.env, FS_MCP_BIN: serverBin, ...opts.env },
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  child.stdin.end(opts.stdin ?? '');
  return new Promise<Run>((ok) => child.on('close', (code) => ok({ code, out, err })));
}

const dir = await mkdtemp(join(tmpdir(), 'fsq-'));
await mkdir(join(dir, 'src'));
await writeFile(join(dir, 'src/a.ts'), 'export const a = 1; // TODO a\n');
for (let i = 0; i < 25; i++)
  await writeFile(join(dir, `n${String(i).padStart(2, '0')}.txt`), 'x\n');
const at = ['--dir', dir];

// tools: every tool, with the write marker taken from annotations.
let r = await fsq([...at, 'tools']);
assert.equal(r.code, 0, r.err);
assert.match(r.out, /✎ edit/);
assert.match(r.out, /^ {2}read/m);

// A call prints the tool's text; key=value values parse as JSON.
r = await fsq([...at, 'search_text', 'searchPattern=TODO', 'context=0']);
assert.equal(r.code, 0, r.err);
assert.match(r.out, /src\/a\.ts:1: export const a/);

// --all --json follows nextCursor and concatenates the pages' arrays.
r = await fsq([...at, 'find_files', 'pattern=*.txt', 'maxResults=10', '--all', '--json']);
const all = JSON.parse(r.out);
assert.equal(all.results.length, 25);
assert.equal(all.nextCursor, undefined);
// Without --all: one page and a hint; with it, no page trailers in the text.
r = await fsq([...at, 'find_files', 'pattern=*.txt', 'maxResults=10']);
assert.match(r.err, /add --all/);
r = await fsq([...at, 'find_files', 'pattern=*.txt', 'maxResults=10', '--all']);
assert.equal(r.out.trim().split('\n').length, 25);

// --json on a tool whose data rides in _meta, and one using structuredContent.
r = await fsq([...at, 'read', 'path=src/a.ts', '--json']);
assert.equal(JSON.parse(r.out).results[0].value.totalLines, 1);
r = await fsq([...at, 'list_roots', '--json']);
assert.equal(JSON.parse(r.out).roots.length, 1);

// Exit codes: a batch that fails part-way is 1, bad usage is 2.
r = await fsq([...at, 'read', 'paths=["src/a.ts","missing.txt"]']);
assert.equal(r.code, 1);
assert.match(r.out, /export const a/);
r = await fsq([...at, 'read', 'oops']);
assert.equal(r.code, 2);
// Option errors too: one line and the usage, no stack trace.
r = await fsq([...at, '--bogus', 'tools']);
assert.equal(r.code, 2);
assert.match(r.err, /^fsq: .*'--bogus'.*\nusage: /);
assert.doesNotMatch(r.err, /^\s+at |node:internal/m);
r = await fsq([...at, '--timeout']);
assert.equal(r.code, 2);
assert.match(r.err, /^fsq: .*--timeout/);
assert.doesNotMatch(r.err, /^\s+at |node:internal/m);
r = await fsq([...at, '--timeout', 'abc', 'tools']);
assert.equal(r.code, 2);
assert.match(r.err, /^fsq: --timeout must be a number/);

// Overwrite confirmation: answered on stdin, declined when stdin is closed.
const create = (content: string) => [
  'create',
  `files=[{"path":"src/a.ts","content":"${content}"}]`,
];
r = await fsq([...at, ...create('two')], { stdin: '' });
assert.equal(r.code, 1);
assert.match(r.err, /already exists/);
assert.match(await readFile(join(dir, 'src/a.ts'), 'utf8'), /TODO a/);
r = await fsq([...at, ...create('two')], { stdin: '1\n' });
assert.equal(r.code, 0, r.err);
assert.equal(await readFile(join(dir, 'src/a.ts'), 'utf8'), 'two');

// Multi-select grant: two directories outside the root, both picked.
const [o1, o2] = [
  await mkdtemp(join(tmpdir(), 'fsq-o1-')),
  await mkdtemp(join(tmpdir(), 'fsq-o2-')),
];
await writeFile(join(o1, 'x.txt'), 'from o1\n');
await writeFile(join(o2, 'y.txt'), 'from o2\n');
const outside = `paths=${JSON.stringify([join(o1, 'x.txt'), join(o2, 'y.txt')])}`;
r = await fsq([...at, 'read', outside], { stdin: '1,2\n' });
assert.equal(r.code, 0, r.err);
assert.match(r.err, /numbers, comma-separated/);
assert.match(r.out, /from o1[\s\S]*from o2/);

// --read-only removes the write tools; complete and help reach their surfaces.
r = await fsq([...at, '--read-only', ...create('three')]);
assert.equal(r.code, 2);
assert.match(r.err, /create not found/);
r = await fsq([...at, 'complete', 'sr']);
assert.match(r.out, /src[/\\]$/m);
r = await fsq([...at, 'help', 'error_recovery']);
assert.match(r.out, /NOT_FOUND/);

// Ctrl+C while the server waits on a confirmation cancels the call: exit 130.
const sigint = join(dir, 'sigint.mjs');
await writeFile(
  sigint,
  `const write = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, ...rest) => {
  if (String(chunk).includes('number:')) setImmediate(() => process.emit('SIGINT'));
  return write(chunk, ...rest);
};`,
);
r = await fsq([...at, ...create('four')], { node: ['--import', pathToFileURL(sigint).href] });
assert.equal(r.code, 130, r.err);
assert.equal(await readFile(join(dir, 'src/a.ts'), 'utf8'), 'two');

// HTTP: an API key is required; 2025-era clients cannot be asked to confirm.
const port = await new Promise<number>((ok) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as AddressInfo;
    probe.close(() => ok(port));
  });
});
const key = 'fsq-check-key-0123456789';
const server = spawn(process.execPath, [serverBin, '--port', String(port), dir], {
  env: { ...process.env, FS_API_KEY: key },
  stdio: 'ignore',
});
try {
  const url = `http://127.0.0.1:${port}/mcp`;
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(`http://127.0.0.1:${port}/healthz`).then(
        (res) => res.ok,
        () => false,
      )
    )
      break;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  r = await fsq(['--url', url, 'list_roots']);
  assert.equal(r.code, 2);
  assert.match(r.err, /401/);
  const withKey = { env: { FS_API_KEY: key } };
  r = await fsq(['--url', url, 'read', `path=${join(dir, 'src/a.ts')}`], withKey);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), 'two');
  const overwrite = `files=[{"path":${JSON.stringify(join(dir, 'src/a.ts'))},"content":"5"}]`;
  r = await fsq(['--url', url, '--legacy', 'create', overwrite], withKey);
  assert.equal(r.code, 1);
  assert.match(r.out, /needs a confirmation this client cannot show/);
  r = await fsq(['--url', url, 'create', overwrite], { ...withKey, stdin: '1\n' });
  assert.equal(r.code, 0, r.err);
  assert.equal(await readFile(join(dir, 'src/a.ts'), 'utf8'), '5');
} finally {
  server.kill();
}

console.log('check: ok');
