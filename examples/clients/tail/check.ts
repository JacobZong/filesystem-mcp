// Keyless end-to-end check: the real app against the built server, over stdio
// in both protocol eras and over HTTP. Run `npm run build` at the repo root first.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = import.meta.dirname;
const serverBin = process.env.FS_MCP_BIN ?? resolve(here, '../../../dist/index.js');
const key = 'tail-check-key-0123456789';

async function waitFor(what: string, pred: () => boolean, ms = 15_000): Promise<void> {
  for (const end = Date.now() + ms; !pred(); await new Promise((ok) => setTimeout(ok, 50))) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
  }
}

function tail(args: string[]) {
  const child = spawn(process.execPath, [join(here, 'tail.ts'), ...args], {
    env: { ...process.env, FS_MCP_BIN: serverBin, FS_API_KEY: key },
  });
  let out = '';
  let err = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (err += c));
  const done = new Promise<number | null>((ok) => child.on('close', ok));
  return {
    out: () => out,
    err: () => err,
    done,
    // Waits for `text` on stdout, failing with what was seen so far.
    see: (text: string) => waitFor(`"${text}" in:\n${out}\n${err}`, () => out.includes(text)),
    stop: () => (child.kill('SIGINT'), done),
  };
}

function httpServer(dir: string, port: number): ChildProcess {
  return spawn(process.execPath, [serverBin, '--port', String(port), dir], {
    env: { ...process.env, FS_API_KEY: key },
    stdio: 'ignore',
  });
}
async function up(port: number): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(`http://127.0.0.1:${port}/healthz`).then(
        (r) => r.ok,
        () => false,
      )
    )
      return;
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error('HTTP server did not start');
}

for (const era of [[], ['--legacy']]) {
  const dir = await mkdtemp(join(tmpdir(), 'tail-'));
  const log = join(dir, 'app.log');
  const other = join(dir, 'other.log');
  await writeFile(log, Array.from({ length: 15 }, (_, i) => `log ${i + 1}\n`).join(''));
  await writeFile(other, 'first\n');

  const t = tail([log, other, '-n', '3', ...era]);
  // The last -n lines of each file, with tail's headers for several files.
  await t.see('first\n');
  assert.match(t.out(), /^==> .*app\.log <==\nlog 13\nlog 14\nlog 15\n/);
  assert.doesNotMatch(t.out(), /log 12/);

  await appendFile(log, 'new 1\n');
  await t.see('new 1\n');
  // A half-written line waits for its newline.
  await appendFile(log, 'part');
  await appendFile(other, 'second\n');
  await t.see('second\n');
  assert.doesNotMatch(t.out(), /part(?!ial)/);
  await appendFile(log, 'ial\n');
  await t.see('partial\n');

  // Truncation starts over; a deleted file is reported, and picked up again.
  await writeFile(log, 'after truncate\n');
  await t.see('after truncate\n');
  assert.match(t.err(), /app\.log: file truncated/);
  await rm(other);
  await waitFor('the deletion', () => /other\.log: Path not found/.test(t.err()));
  await writeFile(other, 'reborn\n');
  await t.see('reborn\n');

  const code = await t.stop();
  if (process.platform !== 'win32') assert.equal(code, 0, t.err());
}

// HTTP: 2026-07-28 follows through a server restart; a 2025 client is refused.
const port = await new Promise<number>((ok) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port } = probe.address() as AddressInfo;
    probe.close(() => ok(port));
  });
});
const dir = await mkdtemp(join(tmpdir(), 'tail-http-'));
const log = join(dir, 'app.log');
await writeFile(log, 'one\ntwo\n');
let server = httpServer(dir, port);
const url = `http://127.0.0.1:${port}/mcp`;
try {
  await up(port);
  const legacy = tail(['--url', url, '--legacy', log]);
  assert.equal(await legacy.done, 1);
  assert.match(legacy.err(), /only notified over stdio/);

  const t = tail(['--url', url, log, '-n', '1']);
  await t.see('two\n');
  assert.doesNotMatch(t.out(), /one/);
  await appendFile(log, 'via http\n');
  await t.see('via http\n');

  server.kill();
  await waitFor('the drop', () => /subscription dropped/.test(t.err()));
  await appendFile(log, 'while down\n');
  server = httpServer(dir, port);
  await up(port);
  await t.see('while down\n'); // re-read on reconnect
  await appendFile(log, 'after restart\n');
  await t.see('after restart\n');
  await t.stop();
} finally {
  server.kill();
}

console.log('check: ok');
