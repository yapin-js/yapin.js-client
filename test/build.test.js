import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, validateConfig, ConfigError } from '../src/config/load.js';
import { build, findIcons, runtimeConfig } from '../src/build/build.js';
import { readGitInfo, remoteToURL, commitURL } from '../src/build/git.js';
import { renderPage } from '../src/installer/page.js';
import { version } from '../src/shared/constants.js';
import { builtinIcon, ICONS } from '../src/shared/icons.js';
import { UI } from '../src/runtime/ui.js';
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
  assert.deepEqual(client.pages.list().map((p) => p.id), ['about', 'settings', 'plugins', 'themes', 'security']);
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

test('icons come from folders and the config, and the config wins', () => {
  const work = mkdtempSync(join(tmpdir(), 'yc-icons-'));
  const dir = join(work, 'icons');
  mkdirSync(dir);
  // Upstream SVGs are pretty-printed and carry width/height; CSS sizes ours, so those are dropped.
  writeFileSync(join(dir, 'brand.svg'), '<svg xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n>\n  <path d="M4 4h16" />\n</svg>\n');
  writeFileSync(join(dir, 'rocket.svg'), '<svg viewBox="0 0 24 24"><path d="M1 1" /></svg>');
  writeFileSync(join(dir, '_wip.svg'), '<svg viewBox="0 0 24 24"><path d="M2 2" /></svg>');
  writeFileSync(join(dir, 'notes.txt'), 'ignored');

  const found = findIcons([dir, join(work, 'missing')]);
  assert.deepEqual(Object.keys(found).sort(), ['brand', 'rocket'], 'skips _ prefixed and non-svg files');
  assert.ok(!/width="24"|height="24"/.test(found.brand), 'width and height are dropped');
  assert.ok(found.brand.includes('viewBox="0 0 24 24"'), 'viewBox is kept');
  assert.ok(found.brand.includes('<path d="M4 4h16" />'), 'the drawing is kept');

  assert.throws(() => findIcons([(() => { writeFileSync(join(dir, 'bad.svg'), 'nope'); return dir; })()]), /is not an SVG/);
});

test('runtimeConfig keeps icons as data, with inline entries overriding folders', () => {
  const config = {
    plugins: { dirs: ['/p'] },
    themes: { dirs: ['/t'], css: '/t/base.css' },
    icons: { dirs: ['/i'], set: { brand: '<svg id="inline"></svg>' } },
  };
  const out = runtimeConfig(config, { icons: { brand: '<svg id="folder"></svg>', other: '<svg id="other"></svg>' } });
  assert.equal(out.icons.set.brand, '<svg id="inline"></svg>', 'icons.set wins over a folder file of the same name');
  assert.equal(out.icons.set.other, '<svg id="other"></svg>');
  assert.ok(!('dirs' in out.icons), 'build-only paths do not reach the client app');
});

test('the built-in icon set is Lucide, and client apps can add to or replace it', () => {
  // Names are resolvable in both the kebab-case Lucide spelling and our camelCase key.
  assert.ok(builtinIcon('rocket').includes('stroke="currentColor"'));
  assert.equal(builtinIcon('triangle-alert'), builtinIcon('alertTriangle'));
  assert.equal(builtinIcon('sliders-horizontal'), builtinIcon('sliders'));
  assert.equal(builtinIcon('shield-check'), builtinIcon('shield'));
  assert.equal(builtinIcon('no-such-icon'), null);
  // CSS sizes icons, so the markup must not pin a size.
  for (const [name, markup] of Object.entries(ICONS)) {
    // Only the root <svg> is unsized; width/height on a shape (copy's <rect>) is geometry and stays.
    const root = markup.match(/<svg\b[^>]*>/)[0];
    assert.ok(!/\s(width|height)=/.test(root), `${name} must not set width or height on <svg>`);
    assert.ok(markup.includes('stroke="currentColor"'), `${name} must inherit its colour`);
    assert.ok(!/\sstyle=|<(script|filter|text|image|foreignObject)\b/i.test(markup), `${name} must survive the SVG sanitizer`);
  }

  const errors = [];
  const ui = new UI({ onError: (error) => errors.push(error) });
  assert.equal(ui.iconNames().length, Object.keys(ICONS).length, 'starts with just the built-ins');

  ui.registerIcons({ brand: '<svg id="brand"></svg>', 'two-words': '<svg id="two"></svg>', rocket: '<svg id="mine"></svg>' });
  assert.ok(ui.iconNames().includes('brand'));
  assert.ok(ui.iconNames().includes('twoWords'), 'kebab-case names are stored camelised');
  assert.equal(errors.length, 0);

  ui.registerIcons({ broken: 'not svg at all' });
  assert.equal(errors.length, 1, 'markup that is not SVG is reported, not drawn');
  assert.match(errors[0].message, /must be SVG markup/);
});
