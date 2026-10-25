import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const SHIM = require.resolve('../src/desktop/shim.cjs');

/** Loads shim.cjs against a fake `electron` and returns its IPC handlers. */
function loadShim({ runtime = '(function(){})', hash, config = {} } = {}) {
  const data = mkdtempSync(join(tmpdir(), 'yc-shim-'));
  const payloadDir = join(data, 'app');
  mkdirSync(payloadDir, { recursive: true });
  writeFileSync(join(payloadDir, 'runtime.js'), runtime);
  const manifest = {
    id: 'demo',
    name: 'Demo',
    version: '1.0.0',
    files: { 'runtime.js': hash ?? createHash('sha256').update(runtime).digest('hex') },
    config: { origins: ['https://www.yapper.website'], api: { allowedOrigins: ['https://api.example.com'] }, plugins: {}, themes: {}, ...config },
  };
  writeFileSync(join(payloadDir, 'manifest.json'), JSON.stringify(manifest));
  const handlers = {};
  const syncHandlers = {};
  const preloads = [];
  const electron = {
    app: { isReady: () => true, once() {}, on() {}, relaunch() {}, quit() {} },
    ipcMain: { handle: (name, fn) => (handlers[name.replace('yapin-client:', '')] = fn), on: (name, fn) => (syncHandlers[name.replace('yapin-client:', '')] = fn) },
    session: { defaultSession: { registerPreloadScript: (p) => preloads.push(p) } },
    shell: { openPath: async () => '', openExternal: async () => {} },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from(`enc:${s}`), decryptString: (b) => b.toString().slice(4) },
    webContents: { getAllWebContents: () => [] },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'electron' ? electron : originalLoad.call(this, request, ...rest);
  };
  let ok;
  try {
    delete require.cache[SHIM];
    ok = require(SHIM)({ payloadDir });
  } finally {
    Module._load = originalLoad;
  }
  const frame = (url) => ({ url });
  const trusted = () => {
    const main = frame('https://www.yapper.website/channels');
    return { senderFrame: main, sender: { mainFrame: main } };
  };
  const call = (name, event, ...args) => handlers[name](event, ...args);
  const callSync = (name, event, ...args) => {
    const e = { ...event, returnValue: undefined };
    syncHandlers[name](e, ...args);
    return e.returnValue;
  };
  return { ok, data, handlers, call, callSync, trusted, frame, preloads };
}

test('a damaged runtime is refused', () => {
  const shim = loadShim({ hash: 'not-the-hash' });
  assert.equal(shim.ok, false);
  assert.equal(Object.keys(shim.handlers).length, 0);
});

test('boot is answered only for the main frame of an allowed origin', () => {
  const shim = loadShim();
  assert.equal(shim.ok, true);
  assert.equal(shim.preloads.length, 1, 'the preload is registered');
  const boot = shim.callSync('boot', shim.trusted());
  assert.equal(boot.runtime, '(function(){})');
  assert.match(boot.args.nativeKey, /^__yc_[0-9a-f]{18}$/);
  assert.deepEqual(boot.args.snapshot.userPlugins, []);

  const evil = shim.frame('https://evil.example/');
  assert.equal(shim.callSync('boot', { senderFrame: evil, sender: { mainFrame: evil } }), null);
  const main = shim.frame('https://www.yapper.website/');
  const sub = shim.frame('https://www.yapper.website/embed');
  assert.equal(shim.callSync('boot', { senderFrame: sub, sender: { mainFrame: main } }), null, 'subframes are refused');
});

test('untrusted senders are rejected by every handler', async () => {
  const shim = loadShim();
  const evil = shim.frame('https://evil.example/');
  for (const name of Object.keys(shim.handlers)) {
    await assert.rejects(shim.call(name, { senderFrame: evil, sender: { mainFrame: evil } }), /Not allowed/, name);
  }
});

test('file access is confined to the plugin and theme folders', async () => {
  const shim = loadShim();
  const t = shim.trusted();
  await shim.call('write', t, 'plugins', 'good.plugin.js', 'export default {}');
  assert.equal(await shim.call('read', t, 'plugins', 'good.plugin.js'), 'export default {}');
  assert.deepEqual(await shim.call('list', t, 'plugins'), ['good.plugin.js']);
  for (const [kind, name] of [['plugins', '../escape.js'], ['plugins', '..\\escape.js'], ['plugins', 'notes.txt'], ['themes', 'theme.js'], ['storage', 'x.js'], ['plugins', '/abs.js'], ['plugins', '.hidden.js']]) {
    await assert.rejects(shim.call('write', t, kind, name, 'x'), /Invalid|Unknown/, `${kind}/${name}`);
  }
  assert.ok(!existsSync(join(shim.data, 'escape.js')));
  await shim.call('remove', t, 'plugins', 'good.plugin.js');
  assert.deepEqual(await shim.call('list', t, 'plugins'), []);
  await assert.rejects(shim.call('open-folder', t, 'storage'), /Unknown folder/);
});

test('storage writes must be valid JSON under a valid namespace', async () => {
  const shim = loadShim();
  const t = shim.trusted();
  await shim.call('storage-write', t, 'plugin.demo', '{"a":1}');
  assert.equal(readFileSync(join(shim.data, 'storage', 'plugin.demo.json'), 'utf8'), '{"a":1}');
  await assert.rejects(shim.call('storage-write', t, '../evil', '{}'), /Invalid storage write/);
  await assert.rejects(shim.call('storage-write', t, 'ok', 'not json'), /JSON/);
  assert.equal(shim.callSync('storage-write-sync', t, 'ok', '{}'), true);
  assert.deepEqual(shim.callSync('boot', t).args.snapshot.storage['plugin.demo'], { a: 1 });
});

test('requests only reach allowed origins, including after redirects', async () => {
  const shim = loadShim();
  const t = shim.trusted();
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push([url, init.headers]);
    if (url.endsWith('/redirect')) return new Response(null, { status: 302, headers: { location: 'https://evil.example/steal' } });
    return new Response('{"ok":true}', { headers: { 'content-type': 'application/json', 'set-cookie': 'a=b' } });
  };
  try {
    const res = await shim.call('request', t, { url: 'https://api.example.com/v1/me', method: 'GET', headers: { cookie: 'x', authorization: 'Bearer t' } });
    assert.equal(res.status, 200);
    assert.equal(res.body, '{"ok":true}');
    assert.equal(res.headers['set-cookie'], undefined, 'cookies never come back');
    assert.equal(seen[0][1].cookie, undefined, 'cookies are never sent');
    assert.equal(seen[0][1].authorization, 'Bearer t');
    await assert.rejects(shim.call('request', t, { url: 'https://evil.example/x' }), /isn't allowed/);
    await assert.rejects(shim.call('request', t, { url: 'https://api.example.com/redirect' }), /evil\.example isn't allowed/);
    await assert.rejects(shim.call('request', t, { url: 'http://api.example.com/x' }), /isn't allowed/);
    const download = await shim.call('request', t, { url: 'https://raw.example.org/p.plugin.js', purpose: 'download' });
    assert.equal(download.status, 200, 'downloads may come from any https host when installs are allowed');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('downloads follow the install settings', async () => {
  const shim = loadShim({ config: { plugins: { user: { install: { url: true, allowedHosts: ['plugins.example'] } } }, themes: { user: { enabled: false } } } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('x');
  try {
    await assert.rejects(shim.call('request', shim.trusted(), { url: 'https://other.example/p.js', purpose: 'download' }), /isn't allowed/);
    assert.equal((await shim.call('request', shim.trusted(), { url: 'https://cdn.plugins.example/p.js', purpose: 'download' })).status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('secrets are stored encrypted and read back', async () => {
  const shim = loadShim();
  const t = shim.trusted();
  await shim.call('secret-set', t, 'token', 's3cret');
  assert.ok(!readFileSync(join(shim.data, 'secrets.json'), 'utf8').includes('s3cret'));
  assert.equal(await shim.call('secret-get', t, 'token'), 's3cret');
  await shim.call('secret-delete', t, 'token');
  assert.equal(await shim.call('secret-get', t, 'token'), null);
  await assert.rejects(shim.call('secret-set', t, '../x', 'v'), /Invalid secret name/);
});

test('the preload injects the runtime as a script whose result is undefined', () => {
  let injected = null;
  const electron = {
    contextBridge: { exposeInMainWorld() {} },
    ipcRenderer: {
      on() {},
      sendSync: () => ({ runtime: '(function(){ return { default: (args) => ({ client: args.manifest.id }) }; })', args: { manifest: { id: 'demo' }, nativeKey: '__yc_test' } }),
    },
    webFrame: {
      executeJavaScript: (code) => {
        injected = code;
        return Promise.resolve();
      },
    },
  };
  const PRELOAD = require.resolve('../src/desktop/preload.cjs');
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'electron' ? electron : originalLoad.call(this, request, ...rest);
  };
  try {
    delete require.cache[PRELOAD];
    require(PRELOAD);
  } finally {
    Module._load = originalLoad;
  }
  assert.ok(injected, 'the runtime is injected');
  const result = vm.runInNewContext(injected);
  assert.equal(result, undefined, 'converting the Client object back to the preload hangs the page');
});

test('only https and mailto links open', async () => {
  const shim = loadShim();
  await assert.rejects(shim.call('open-external', shim.trusted(), 'file:///C:/Windows/System32/calc.exe'), /Only https/);
  await shim.call('open-external', shim.trusted(), 'https://example.com');
});
