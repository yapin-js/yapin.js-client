import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createArchive, listFiles, readFile, readHeader } from '../src/installer/asar.js';
import { checkFuses, FuseNames, readFuses } from '../src/installer/fuses.js';
import { findInstalls, inspect, install, InstallError, repair, uninstall } from '../src/installer/patch.js';
import { expandPath } from '../src/installer/paths.js';
import { createZip, crc32 } from '../src/build/zip.js';
import { escapeHTML, inlineMarkdown, renderPage } from '../src/installer/page.js';
import { startServer } from '../src/installer/server.js';

const tmp = (prefix = 'yc-inst-') => mkdtempSync(join(tmpdir(), prefix));

function fakeApp({ version = '1.1.0', name = 'yapper-desktop', unpacked = true } = {}) {
  const location = tmp('yc-app-');
  const resources = join(location, 'resources');
  mkdirSync(resources, { recursive: true });
  createArchive({ 'package.json': JSON.stringify({ name, productName: 'Yapper', version, main: 'main.js' }), 'main.js': 'module.exports = 1;' }, join(resources, 'app.asar'));
  if (unpacked) {
    mkdirSync(join(resources, 'app.asar.unpacked', 'native'), { recursive: true });
    writeFileSync(join(resources, 'app.asar.unpacked', 'native', 'a.node'), `native ${version}`);
  }
  return { location, resources };
}

function fakePayload(id = 'demo', version = '1.0.0') {
  const dir = tmp('yc-payload-');
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify({ id, name: `Demo ${id}`, version, framework: '0.1.0' }));
  writeFileSync(join(dir, 'runtime.js'), '(function(){})');
  writeFileSync(join(dir, 'shim.cjs'), 'module.exports = () => true;');
  return dir;
}

const appVersion = (resources) => JSON.parse(readFile(join(resources, 'app.asar'), 'package.json').toString()).version;

test('asar round trip, nested folders and header layout', () => {
  const file = join(tmp(), 'x.asar');
  createArchive({ 'package.json': '{"a":1}', 'lib/deep/index.js': 'x', 'big.bin': Buffer.alloc(70_000, 7) }, file);
  assert.deepEqual(listFiles(file).map((f) => f.path).sort(), ['big.bin', 'lib/deep/index.js', 'package.json']);
  assert.equal(readFile(file, 'lib/deep/index.js').toString(), 'x');
  assert.equal(readFile(file, 'big.bin').length, 70_000);
  assert.equal(readFile(file, 'missing.js'), null);
  const { header, base } = readHeader(file);
  assert.equal(base % 4, 0, 'data starts 4-byte aligned like Electron expects');
  assert.equal(header.files.lib.files.deep.files['index.js'].size, 1);
  assert.throws(() => readHeader(join(tmp(), 'nope.asar')));
});

test('fuses are read from the sentinel and integrity validation blocks installs', () => {
  const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
  const wire = Buffer.from([1, FuseNames.length, ...FuseNames.map((n) => (n === 'EnableEmbeddedAsarIntegrityValidation' ? 0x31 : 0x30))]);
  const binary = Buffer.concat([Buffer.alloc(100), sentinel, wire, Buffer.alloc(10)]);
  const fuses = readFuses(binary);
  assert.equal(fuses.fuses.EnableEmbeddedAsarIntegrityValidation, true);
  assert.equal(fuses.fuses.RunAsNode, false);
  assert.equal(checkFuses(fuses).ok, false);
  assert.equal(checkFuses(null).ok, true);
  assert.equal(readFuses(Buffer.alloc(50)), null);
});

test('zip entries are valid deflate with the right crc', () => {
  const data = Buffer.from('hello hello hello hello hello');
  const zip = createZip([{ name: 'dir/a.txt', data }, { name: 'run.sh', data: Buffer.from('#!/bin/sh'), mode: 0o755 }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const nameLength = zip.readUInt16LE(26);
  const size = zip.readUInt32LE(18);
  const body = zip.subarray(30 + nameLength, 30 + nameLength + size);
  assert.equal(inflateRawSync(body).toString(), data.toString());
  assert.equal(zip.readUInt32LE(14), crc32(data));
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});

test('install, update the desktop app, repair, uninstall', () => {
  const { resources } = fakeApp();
  const payload = fakePayload();
  const dataDir = tmp('yc-data-');
  assert.equal(inspect(resources).state, 'clean');

  const steps = [];
  const result = install({ resources, payload, dataDir, onStep: (s) => steps.push(s) });
  assert.equal(result.previous, 'clean');
  assert.ok(steps.includes('Writing the launcher'));
  const status = inspect(resources);
  assert.equal(status.state, 'installed');
  assert.equal(status.marker.id, 'demo');
  assert.ok(existsSync(join(resources, '_app.asar')));
  assert.ok(existsSync(join(resources, '_app.asar.unpacked', 'native', 'a.node')), 'unpacked native files move with the asar');
  const stubPkg = JSON.parse(readFile(join(resources, 'app.asar'), 'package.json').toString());
  assert.equal(stubPkg.productName, 'Yapper', 'the stub keeps the app name so its user data folder stays the same');
  assert.equal(stubPkg.version, '1.1.0');
  assert.match(readFile(join(resources, 'app.asar'), 'index.js').toString(), /require\(path\.join\(original/);
  assert.ok(existsSync(join(dataDir, 'app', 'manifest.json')));

  createArchive({ 'package.json': JSON.stringify({ name: 'yapper-desktop', version: '1.2.0', main: 'main.js' }), 'main.js': '' }, join(resources, 'app.asar'));
  mkdirSync(join(resources, 'app.asar.unpacked', 'native'), { recursive: true });
  writeFileSync(join(resources, 'app.asar.unpacked', 'native', 'a.node'), 'native 1.2.0');
  const stale = inspect(resources);
  assert.equal(stale.state, 'needs-repair');
  assert.equal(stale.stale, true);

  repair({ resources, id: 'demo', dataDir });
  assert.equal(inspect(resources).state, 'installed');
  assert.equal(JSON.parse(readFile(join(resources, '_app.asar'), 'package.json').toString()).version, '1.2.0');
  assert.equal(readFileSync(join(resources, '_app.asar.unpacked', 'native', 'a.node'), 'utf8'), 'native 1.2.0');

  const removed = uninstall({ resources, id: 'demo', dataDir });
  assert.equal(removed.removed, true);
  assert.equal(inspect(resources).state, 'clean');
  assert.equal(appVersion(resources), '1.2.0');
  assert.equal(readFileSync(join(resources, 'app.asar.unpacked', 'native', 'a.node'), 'utf8'), 'native 1.2.0');
  assert.ok(existsSync(join(dataDir, 'plugins')), 'data is kept without purge');
  assert.ok(!existsSync(join(dataDir, 'app')));
});

test('an update that leaves no new unpacked folder keeps the old native files', () => {
  const { resources } = fakeApp();
  const dataDir = tmp('yc-data-');
  install({ resources, payload: fakePayload(), dataDir });
  createArchive({ 'package.json': JSON.stringify({ name: 'yapper-desktop', version: '1.3.0', main: 'main.js' }) }, join(resources, 'app.asar'));
  repair({ resources, id: 'demo', dataDir });
  assert.ok(existsSync(join(resources, '_app.asar.unpacked', 'native', 'a.node')));
  uninstall({ resources, id: 'demo', dataDir, purge: true });
  assert.ok(existsSync(join(resources, 'app.asar.unpacked', 'native', 'a.node')));
  assert.ok(!existsSync(dataDir), 'purge deletes the data folder');
});

test('refuses foreign mods and other client apps unless forced', () => {
  const foreign = fakeApp({ name: 'some-other-mod' });
  assert.equal(inspect(foreign.resources).state, 'foreign');
  assert.throws(() => install({ resources: foreign.resources, payload: fakePayload(), dataDir: tmp() }), (e) => e instanceof InstallError && e.code === 'FOREIGN');

  const { resources } = fakeApp();
  install({ resources, payload: fakePayload('first'), dataDir: tmp() });
  assert.throws(() => install({ resources, payload: fakePayload('second'), dataDir: tmp() }), (e) => e.code === 'OTHER_CLIENT');
  assert.throws(() => uninstall({ resources, id: 'second' }), (e) => e.code === 'OTHER_CLIENT');
});

test('reinstalling the same client app updates it in place', () => {
  const { resources } = fakeApp();
  const dataDir = tmp();
  install({ resources, payload: fakePayload('demo', '1.0.0'), dataDir });
  writeFileSync(join(dataDir, 'plugins', 'mine.plugin.js'), 'export default {}');
  const again = install({ resources, payload: fakePayload('demo', '2.0.0'), dataDir });
  assert.equal(again.previous, 'installed');
  assert.equal(inspect(resources).marker.version, '2.0.0');
  assert.ok(existsSync(join(dataDir, 'plugins', 'mine.plugin.js')), 'user plugins survive updates');
});

test('a held lock stops a second install', () => {
  const { resources } = fakeApp();
  writeFileSync(join(resources, 'yapin-client.lock'), '');
  assert.throws(() => install({ resources, payload: fakePayload(), dataDir: tmp() }), (e) => e.code === 'LOCKED');
});

test('findInstalls expands paths and skips folders without the app', () => {
  const { location } = fakeApp();
  const target = { packageName: 'yapper-desktop', productName: 'Yapper', executable: {}, processName: {}, locations: { [process.platform]: ['%NOPE%/missing', location] } };
  const found = findInstalls({ target });
  assert.equal(found.length, 1);
  assert.equal(found[0].location, location);
  assert.equal(expandPath('%FOO%/x', { FOO: 'bar' }), 'bar/x');
  assert.equal(expandPath('$FOO/x', { FOO: 'bar' }), 'bar/x');
});

test('installer page escapes config text and only allows safe images and links', () => {
  assert.equal(escapeHTML('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  assert.equal(inlineMarkdown('**a** [b](https://x.y) [c](javascript:alert(1))'), '<strong>a</strong> <a href="https://x.y" target="_blank" rel="noopener noreferrer">b</a> [c](javascript:alert(1))');
  const html = renderPage(
    {
      preset: 'showcase',
      app: { name: 'A</script><script>x', version: '1.0.0', links: {} },
      marketing: { title: '<img onerror=1>', logo: 'javascript:alert(1)', accent: 'red;}body{', screenshots: [{ src: 'http://insecure/x.png' }], changelog: [{ version: '1', notes: ['n'] }] },
    },
    { nonce: 'abc' },
  );
  assert.ok(!html.includes('<img onerror'));
  assert.ok(!html.includes('javascript:alert'));
  assert.ok(!html.includes('red;}body{'));
  assert.ok(!html.includes('http://insecure'));
  assert.ok(!/<\/script><script>x/.test(html.split('id="installer-data">')[1].split('</script>')[0]));
  assert.match(html, /<script nonce="abc">/);
  for (const preset of ['minimal', 'default', 'showcase']) assert.match(renderPage({ preset, app: { name: 'A', version: '1' }, marketing: {} }, { nonce: 'n' }), /<!doctype html>/);
});

test('installer server needs the token, the right Host and the right Origin', async () => {
  const calls = [];
  const operations = {
    status: async () => ({ installs: [], running: false }),
    install: async (args) => (calls.push(args), { ok: true, steps: [] }),
    launch: async () => ({ ok: true }),
  };
  const server = await startServer({ installer: { app: { name: 'A', version: '1' }, marketing: {}, closeApp: 'ask' }, operations });
  try {
    const token = new URL(server.url).hash.replace('#t=', '');
    const base = `http://127.0.0.1:${server.port}`;
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /script-src 'nonce-/);
    assert.ok(!(await page.text()).includes(token), 'the token is never in the page');
    assert.equal((await fetch(`${base}/api/status`)).status, 403);
    assert.equal((await fetch(`${base}/api/status`, { headers: { 'x-installer-token': 'wrong' } })).status, 403);
    assert.equal((await fetch(`${base}/api/status`, { headers: { 'x-installer-token': token } })).status, 200);
    const noOrigin = await fetch(`${base}/api/install`, { method: 'POST', headers: { 'x-installer-token': token }, body: '{}' });
    assert.equal(noOrigin.status, 403);
    const good = await fetch(`${base}/api/install`, { method: 'POST', headers: { 'x-installer-token': token, origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ index: 0, close: true }) });
    assert.equal(good.status, 200);
    assert.deepEqual(calls[0].close, true);
  } finally {
    server.stop();
  }
});
