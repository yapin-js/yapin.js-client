import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig, ConfigError } from '../src/config/load.js';
import { build } from '../src/build/build.js';
import { readGitInfo, remoteToURL, commitURL } from '../src/build/git.js';
import { renderPage } from '../src/installer/page.js';
import { version } from '../src/shared/constants.js';
import { readBundle } from '../src/build/windows.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/sample', import.meta.url));
const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

function copyFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'yc-build-'));
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

test('framework version matches package.json', () => {
  assert.equal(version, PACKAGE.version);
  assert.deepEqual(PACKAGE.dependencies ?? {}, {}, 'zero dependencies');
});

test('config validation lists every problem at once', () => {
  assert.throws(
    () => validateConfig({ id: 'Bad Id', name: '', version: 'x', settings: { fn: () => {} }, links: { site: 'http://insecure' }, api: { services: { s: { baseURL: 'ftp://x' } } } }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.problems.length, 6);
      assert.ok(error.problems.some((p) => /settings\.fn is a function/.test(p)));
      return true;
    },
  );
});

test('config derives allowed origins and warns about typos', () => {
  const { config, warnings } = validateConfig({
    id: 'ok',
    name: 'OK',
    version: '1.0.0',
    plugns: {},
    api: { services: { a: { baseURL: 'https://api.a.com/v1' } } },
    badges: { sources: [{ id: 'b', url: 'https://cdn.b.com/badges.json' }] },
  });
  assert.deepEqual(config.api.allowedOrigins.sort(), ['https://api.a.com', 'https://cdn.b.com']);
  assert.match(warnings[0], /did you mean "plugins"/);
});

test('config file loading reads marketing json and resolves paths', async () => {
  const dir = copyFixture();
  const { config } = await loadConfig({ cwd: dir });
  assert.equal(config.id, 'sample-client');
  assert.equal(config.installer.marketing.title, 'Sample <Client>');
  assert.equal(config.entry, join(dir, 'src', 'index.js'));
});

test('build: payload, installer, zip, userscript; the runtime boots', async () => {
  const dir = copyFixture();
  const { config, root } = await loadConfig({ cwd: dir });
  config.installer.windows.nsis = false; // the browser launcher, whose bundle is checked below (nsis.test.js covers the wizard)
  const result = await build(config, { root });
  assert.equal(result.exeKind, 'launcher');
  assert.deepEqual(result.plugins.map((p) => p.replace(/\\/g, '/').split('/plugins/')[1]), ['folder-plugin/index.js', 'single.js']);
  for (const file of ['payload/manifest.json', 'payload/runtime.js', 'payload/preload.cjs', 'payload/shim.cjs', 'sample-client.user.js', 'sample-client-1.2.3-installer.zip', 'installer/sample-client/installer.mjs', 'installer/sample-client/installer.json', 'installer/sample-client/install.sh', 'installer/sample-client/Install Sample Client.command', 'sample-client-1.2.3-setup.exe']) {
    assert.ok(existsSync(join(result.outDir, file)), file);
  }
  const manifest = JSON.parse(readFileSync(join(result.payloadDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.config.api.allowedOrigins.includes('https://badges.example.com'), true);
  assert.equal(manifest.config.plugins.dirs, undefined, 'build paths stay out of the manifest');
  assert.equal(manifest.git, null);

  const userscript = readFileSync(result.userscriptFile, 'utf8');
  assert.match(userscript, /@run-at\s+document-start/);
  assert.match(userscript, /@match\s+https:\/\/www\.yapper\.website\/\*/);

  const installer = JSON.parse(readFileSync(join(result.installerDir, 'installer.json'), 'utf8'));
  const html = renderPage(installer, { nonce: 'x' });
  assert.match(html, /Sample &lt;Client&gt;/);
  assert.match(html, /What’s new/);
  assert.ok(!existsSync(join(result.installerDir, 'Install Sample Client.cmd')), 'no .cmd any more');
  const bundle = readBundle(readFileSync(result.exeFile));
  assert.ok(bundle['installer.mjs'] && bundle['payload/runtime.js'] && bundle['installer.json']);
  assert.ok(!bundle['install.sh'], 'the .exe leaves out the macOS and Linux launchers');
  assert.match(bundle['__meta.txt'].toString(), /^id=sample-client\nname=Sample Client\nversion=1\.2\.3\nexe=.*Yapper\.exe/);

  const runtime = readFileSync(join(result.payloadDir, 'runtime.js'), 'utf8');
  const client = (0, eval)(runtime)().default({ manifest, environment: {} });
  client.logger.sink = { debug() {}, log() {}, warn() {}, error() {} };
  await client.ready;
  assert.equal(globalThis.__sampleSetup, 'setup:Sample Client');
  assert.equal(globalThis.__singleStarted, 2);
  assert.equal(client.about.get('custom.thing').value, 'yes');
  assert.ok(client.themes.has('dark-blue'));
  assert.ok(client.plugins.has('folder-plugin'));
  assert.ok(!client.plugins.has('ignored'));
  assert.deepEqual(client.pages.list().map((p) => p.id), ['about', 'settings', 'plugins', 'themes']);
  client.stop();
});

test('build refuses to empty a folder it did not make', async () => {
  const dir = copyFixture();
  const { config, root } = await loadConfig({ cwd: dir });
  writeFileSync(join(dir, 'precious.txt'), 'x');
  await assert.rejects(build({ ...config, outDir: dir }, { root }), /can't be the project folder/);
  const other = mkdtempSync(join(tmpdir(), 'yc-other-'));
  writeFileSync(join(other, 'precious.txt'), 'x');
  await assert.rejects(build({ ...config, outDir: other }, { root }), /refusing to delete/);
});

test('git remotes become browsable URLs without credentials', () => {
  assert.equal(remoteToURL('git@github.com:yapin-js/client.git'), 'https://github.com/yapin-js/client');
  assert.equal(remoteToURL('https://user:token@gitlab.com/a/b.git'), 'https://gitlab.com/a/b');
  assert.equal(remoteToURL('ssh://git@host.com:22/a/b.git'), 'https://host.com/a/b');
  assert.equal(commitURL('https://github.com/a/b', 'abc'), 'https://github.com/a/b/commit/abc');
  assert.equal(commitURL('https://gitlab.com/a/b', 'abc'), 'https://gitlab.com/a/b/-/commit/abc');
  assert.equal(readGitInfo(tmpdir()), null);
});
