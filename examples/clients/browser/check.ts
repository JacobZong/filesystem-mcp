// Keyless end-to-end check: starts the real app and server, then drives the
// page's JSON API the way index.html does. Run `npm run build` at the repo
// root first.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = import.meta.dirname;
const serverBin = process.env.FS_MCP_BIN ?? resolve(here, '../../../dist/index.js');
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function start(dir: string, args: string[] = []) {
  const child = spawn(process.execPath, [join(here, 'server.ts'), dir, '--port', '0', ...args], {
    env: { ...process.env, FS_MCP_BIN: serverBin },
  });
  let err = '';
  child.stderr.on('data', (c) => (err += c));
  const exited = new Promise<number | null>((ok) => child.on('close', ok));
  const base = await new Promise<string>((ok, fail) => {
    let out = '';
    child.stdout.on(
      'data',
      (c) => (out += c) && /http:\S+/.test(out) && ok(/http:\S+/.exec(out)![0]),
    );
    child.on('exit', () => fail(new Error(`app exited: ${out}`)));
  });
  const api = async (route: string, body: object = {}): Promise<any> => {
    const res = await fetch(`${base}api/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return res.ok ? json : { httpStatus: res.status, ...json };
  };
  // Ctrl+C: resolves with the exit code and everything the app wrote to stderr.
  const interrupt = async () => (child.kill('SIGINT'), { code: await exited, err });
  return { base, api, interrupt, stop: () => child.kill() };
}

// The page's call loop with scripted answers instead of a dialog.
async function call(api: any, name: string, args: object, answer: (params: any) => object) {
  let body: any = { name, arguments: args };
  for (let round = 0; ; round++) {
    const result = await api('call', body);
    if (result.resultType !== 'input_required') return { result, rounds: round };
    const inputResponses: Record<string, object> = {};
    for (const [key, req] of Object.entries<any>(result.inputRequests)) {
      inputResponses[key] = answer(req.params);
    }
    body = { ...body, inputResponses, requestState: result.requestState };
  }
}

const dir = await mkdtemp(join(tmpdir(), 'browser-'));
await writeFile(join(dir, 'a.txt'), 'one\n');
await writeFile(join(dir, 'dot.png'), Buffer.from(PNG, 'base64'));
await writeFile(join(dir, '.env'), 'SECRET=1\n');
const app = await start(dir);
try {
  // The page, and the guards in front of the API.
  const page = await fetch(app.base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Workspace browser<\/title>/);
  const plain = await fetch(`${app.base}api/info`, { method: 'POST', body: '{}' });
  assert.equal(plain.status, 404, 'non-JSON POSTs are refused');
  const rebound = await new Promise<number>((ok) =>
    request(`${app.base}api/info`, { method: 'POST', headers: { host: 'evil.example' } }, (res) =>
      ok(res.statusCode!),
    ).end(),
  );
  assert.equal(rebound, 403, 'a foreign Host header is refused');

  const info = await app.api('info');
  assert.deepEqual(info.roots.roots, [dir]);
  assert.ok(info.tools.includes('create'));

  // list: data in _meta, secret files left out.
  const { result: listing } = await call(app.api, 'list', { path: dir }, () => ({}));
  const names = listing._meta.entries.map((e: any) => e.name);
  assert.deepEqual(names.toSorted(), ['a.txt', 'dot.png']);

  // Overwrite: input_required with an enum form; skip/decline keep the file.
  const save = { files: [{ path: join(dir, 'a.txt'), content: 'two\n' }] };
  let run = await call(app.api, 'create', save, () => ({ action: 'decline' }));
  assert.equal(run.rounds, 1);
  assert.equal(run.result.isError, true);
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'one\n');
  let asked: any;
  run = await call(app.api, 'create', save, (params) => {
    asked = params.requestedSchema.properties;
    return { action: 'accept', content: { choice: 'overwrite' } };
  });
  assert.deepEqual(asked.choice.enum, ['overwrite', 'skip']);
  assert.equal(run.result.isError, undefined);
  assert.equal(await readFile(join(dir, 'a.txt'), 'utf8'), 'two\n');

  // A tampered requestState is rejected: the server signs it.
  const first = await app.api('call', { name: 'create', arguments: save });
  const forged = await app.api('call', {
    name: 'create',
    arguments: save,
    inputResponses: Object.fromEntries(
      Object.keys(first.inputRequests).map((key) => [
        key,
        { action: 'accept', content: { choice: 'overwrite' } },
      ]),
    ),
    requestState: `${first.requestState.slice(0, -4)}AAAA`,
  });
  assert.equal(forged.httpStatus, 500);
  assert.match(forged.error, /Invalid or expired requestState/);

  // Two folders outside the root: one multi-select form, both granted.
  const outA = await mkdtemp(join(tmpdir(), 'browser-a-'));
  const outB = await mkdtemp(join(tmpdir(), 'browser-b-'));
  await writeFile(join(outA, 'x.txt'), 'A\n');
  await writeFile(join(outB, 'y.txt'), 'B\n');
  const paths = [join(outA, 'x.txt'), join(outB, 'y.txt')];
  run = await call(app.api, 'read', { paths }, (params) => {
    asked = params.requestedSchema.properties;
    return { action: 'accept', content: { choice: asked.choice.items.enum } };
  });
  assert.equal(asked.choice.type, 'array');
  assert.equal(run.result.isError, undefined);
  assert.match(run.result.content[0].text, /A\n[\s\S]*B\n/);

  // Completions on the file template, percent-encoded both ways.
  const { completion } = await app.api('complete', { value: encodeURIComponent(`${dir}/a`) });
  assert.ok(completion.values.map(decodeURIComponent).includes(join(dir, 'a.txt')));

  // resources/read: text, an image as a base64 blob, a secret file refused,
  // and fresh bytes right after a write (the app bypasses the 5 s cache).
  const uri = (p: string) => `filesystem-mcp://file/${encodeURIComponent(p).replace(/%2F/gi, '/')}`;
  let read = await app.api('read', { uri: uri(join(dir, 'a.txt')) });
  assert.equal(read.contents[0].text, 'two\n');
  await call(
    app.api,
    'create',
    { files: [{ path: join(dir, 'a.txt'), content: '3\n', overwrite: true }] },
    () => ({}),
  );
  read = await app.api('read', { uri: uri(join(dir, 'a.txt')) });
  assert.equal(read.contents[0].text, '3\n');
  read = await app.api('read', { uri: uri(join(dir, 'dot.png')) });
  assert.equal(read.contents[0].mimeType, 'image/png');
  assert.equal(read.contents[0].blob, PNG);
  read = await app.api('read', { uri: uri(join(dir, '.env')) });
  assert.equal(read.httpStatus, 500);

  // Search a subfolder and open a match the way the page does: the match
  // path is relative to the root the result names, so it is joined there.
  await call(
    app.api,
    'create',
    { files: [{ path: join(dir, 'sub', 'b.txt'), content: 'NEEDLE\n' }] },
    () => ({}),
  );
  const { result: found } = await call(
    app.api,
    'search_text',
    { path: join(dir, 'sub'), searchPattern: 'NEEDLE' },
    () => ({}),
  );
  const [match] = found._meta.matches;
  assert.equal(match.file, 'sub/b.txt');
  read = await app.api('read', { uri: uri(join(found._meta.root, match.file)) });
  assert.equal(read.contents[0].text, 'NEEDLE\n');
} finally {
  app.stop();
}

// --read-only: the write tools are not there, so the page hides its buttons.
const ro = await start(dir, ['--read-only']);
try {
  assert.ok(!(await ro.api('info')).tools.includes('create'));
  // Ctrl+C exits 0, without the server-crashed message. Not on Windows, where
  // kill() ends the app without running its SIGINT handler.
  if (process.platform !== 'win32') {
    const { code, err } = await ro.interrupt();
    assert.equal(code, 0, err);
    assert.doesNotMatch(err, /filesystem-mcp exited/);
  }
} finally {
  ro.stop();
}

console.log('check: ok');
