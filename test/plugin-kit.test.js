import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '../src/runtime/client.js';
import { MemoryBackend } from '../src/runtime/storage.js';
import { canonicalText, parseMeta, readSignature } from '../src/runtime/meta.js';
import { Trust } from '../src/runtime/plugins.js';
import { ManifestError, validateManifest } from '../src/plugin-kit/manifest.js';
import { formatHeader, headerTags, withSignature } from '../src/plugin-kit/header.js';
import { buildPlugin, indexEntry, sha256 } from '../src/plugin-kit/build.js';
import { checkAgainstManifest, checkFile } from '../src/plugin-kit/check.js';
import { generateKeys, signText, verifyText } from '../src/plugin-kit/sign.js';
import { apiVersion, version as frameworkVersion } from '../src/shared/constants.js';

const silent = { debug() {}, log() {}, info() {}, warn() {}, error() {} };

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'yc-plugin-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

const base = {
  id: 'demo',
  name: 'Demo',
  description: 'A demo.',
  version: '1.2.3',
  authors: ['Ada <https://ada.dev>'],
  apiVersion,
};

function manifestFor(root, extra = {}) {
  return validateManifest({ ...base, ...extra }, { root }).manifest;
}

function sampleProject(entry = 'export default { start() {} };') {
  return project({ 'src/index.js': entry });
}

test('a manifest fills in what it can and parses authors the way headers write them', () => {
  const root = sampleProject();
  const { manifest, warnings } = validateManifest(base, { root });
  assert.deepEqual(manifest.authors, [{ name: 'Ada', url: 'https://ada.dev' }]);
  assert.equal(manifest.entry, join(root, 'src', 'index.js'));
  assert.equal(manifest.outDir, join(root, 'dist'));
  assert.deepEqual([manifest.platforms, manifest.tags, manifest.dependencies], [[], [], []]);
  assert.deepEqual(warnings, []);
});

test('a manifest reports every problem at once', () => {
  const root = sampleProject();
  let error;
  try {
    validateManifest({ id: 'Bad Id', version: '1.2', authors: [], website: 'http://x.example', platforms: ['solaris'], minClientVersion: '1', dependencies: ['demo'], entry: 'nope.js' }, { root });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof ManifestError);
  const joined = error.problems.join('\n');
  for (const expected of [/id "Bad Id"/, /version "1\.2"/, /name is required/, /authors is required/, /website must be an https/, /solaris/, /minClientVersion "1"/, /nope\.js/]) {
    assert.match(joined, expected);
  }
});

test('a manifest rejects an apiVersion this framework does not have', () => {
  const root = sampleProject();
  assert.throws(() => validateManifest({ ...base, apiVersion: apiVersion + 1 }, { root }), /newer than this framework's/);
  assert.equal(validateManifest({ ...base, apiVersion: undefined }, { root }).manifest.apiVersion, apiVersion);
});

test('the generated header is ordered, complete, and round trips through the parser', () => {
  const root = sampleProject();
  const manifest = manifestFor(root, { license: 'MIT', website: 'https://demo.example', minClientVersion: '0.1.5', platforms: ['win32'], tags: ['fun', 'ui'], dependencies: ['other'], updateUrl: 'https://demo.example/demo.plugin.js' });
  assert.deepEqual(headerTags(manifest).map(([tag]) => tag), ['id', 'name', 'description', 'version', 'author', 'license', 'website', 'apiVersion', 'minClientVersion', 'platforms', 'tags', 'dependencies', 'updateUrl']);
  const { meta } = parseMeta(formatHeader(manifest));
  assert.equal(meta.id, 'demo');
  assert.equal(meta.minClientVersion, '0.1.5');
  assert.deepEqual(meta.platforms, ['win32']);
  assert.deepEqual(meta.tags, ['fun', 'ui']);
  assert.deepEqual(meta.dependencies, ['other']);
  assert.deepEqual(meta.authors, [{ name: 'Ada', url: 'https://ada.dev' }]);
  assert.equal(meta.updateUrl, 'https://demo.example/demo.plugin.js');
});

test('building bundles the project into one file without inlining the runtime', () => {
  const root = project({
    'src/index.js': "import { definePlugin } from 'yapin.js-client/runtime';\nimport { label } from './label.js';\nexport default definePlugin({ start(ctx) { ctx.toast(label); } });",
    'src/label.js': "export const label = 'hi';",
  });
  const manifest = manifestFor(root);
  const build = buildPlugin(manifest, { root });
  const text = readFileSync(build.file, 'utf8');
  assert.equal(text, build.text);
  assert.match(text, /^\/\*\*\n \* @id demo\n/);
  assert.match(text, /export default __bundle\.default;/);
  assert.match(text, /const label = 'hi';/);
  // The shim, not the real module: a downloaded plugin must not carry a second copy of the runtime.
  assert.match(text, /const definePlugin = \(definition\) => definition;/);
  assert.doesNotMatch(text, /class PluginManager/);
  assert.ok(build.bytes < 8000, `expected a small file, got ${build.bytes} bytes`);
  assert.equal(build.sha256, sha256(text));
});

test('building is reproducible and the index entry carries the hash', () => {
  const root = sampleProject();
  const manifest = manifestFor(root, { updateUrl: 'https://demo.example/demo.plugin.js' });
  const first = buildPlugin(manifest, { root, write: false });
  const second = buildPlugin(manifest, { root, write: false });
  assert.equal(first.sha256, second.sha256);
  const entry = indexEntry(manifest, first);
  assert.equal(entry.sha256, sha256(first.text));
  assert.equal(entry.downloadUrl, 'https://demo.example/demo.plugin.js');
  assert.equal(entry.version, '1.2.3');
});

test('a hash describes the file people download, signature included', () => {
  const root = sampleProject();
  const manifest = manifestFor(root, { updateUrl: 'https://demo.example/demo.plugin.js' });
  const build = buildPlugin(manifest, { root, write: false });
  const keys = generateKeys();
  const signed = signText(build.text, { keyId: 'ada', privateKey: keys.privateKey });
  assert.notEqual(sha256(signed), build.sha256);
  // The entry a registry holds must hash what is actually served, or verifying a download fails.
  const entry = indexEntry(manifest, { ...build, text: signed, bytes: Buffer.byteLength(signed), sha256: sha256(signed) });
  assert.equal(entry.sha256, sha256(signed));
  assert.equal(entry.bytes, Buffer.byteLength(signed));
});

test('a plugin file people download must describe itself; one built into a client app need not', () => {
  const header = '/**\n * @id demo\n */\nexport default { id: "demo", name: "Demo" };\n';
  const standalone = checkFile('demo.plugin.js', header);
  assert.deepEqual(standalone.problems.map((p) => p.replace(/ \(or.*/, '')), ['no @name', 'no @version', 'no @author']);
  const bundled = checkFile('plugins/demo.js', header);
  assert.deepEqual(bundled.problems, []);
  assert.equal(bundled.warnings.filter((w) => /no @name|no @version|no @author/.test(w)).length, 3);
});

test('checks catch what a reviewer would have to catch by hand', () => {
  const bad = checkFile('x.plugin.js', [
    '/**',
    ' * @id Bad_Id',
    ' * @version 1.0.0',
    ' * @author Ada',
    ' * @name Bad',
    ' * @apiVersion 99',
    ' * @minClientVersion 1.2',
    ' * @platforms solaris',
    ' * @updateUrl http://insecure.example/x.js',
    ' * @signature nonsense',
    ' */',
    "export const notDefault = () => import('https://cdn.example/more.js');",
  ].join('\n'));
  const problems = bad.problems.join('\n');
  assert.match(problems, /@id "Bad_Id"/);
  assert.match(problems, /@apiVersion 99/);
  assert.match(problems, /@minClientVersion "1\.2"/);
  assert.match(problems, /solaris/);
  assert.match(problems, /@updateUrl must be an https link/);
  assert.match(problems, /no default export/);
  assert.match(problems, /@signature line is malformed/);
  // Loading code from a URL is legal, but it is outside anything a signature can vouch for.
  assert.match(bad.warnings.join('\n'), /loads code from a URL at runtime/);
});

test('a plugin file cannot import the parts of the runtime it will not get', () => {
  const root = sampleProject();
  const file = join(root, 'src', 'index.js');
  writeFileSync(file, "import { h, getClient } from 'yapin.js-client/runtime';\nexport default { start() { getClient(); h('div'); } };");
  const { problems } = checkFile(file);
  assert.match(problems.join('\n'), /can't import "h", "getClient"/);
  assert.match(problems.join('\n'), /everything else is on ctx/);
  writeFileSync(file, "import { definePlugin, apiVersion } from 'yapin.js-client/runtime';\nexport default definePlugin({ apiVersion, start() {} });");
  assert.deepEqual(checkFile(file).problems, []);
});

test('a built file that no longer matches its manifest is caught', () => {
  const root = sampleProject();
  const manifest = manifestFor(root);
  const build = buildPlugin(manifest, { root, write: false });
  assert.deepEqual(checkAgainstManifest(manifest, build.text), []);
  const stale = build.text.replace('@version 1.2.3', '@version 1.0.0');
  assert.match(checkAgainstManifest(manifest, stale).join('\n'), /says @version "1\.0\.0" but the manifest says "1\.2\.3"/);
});

test('themes are checked as themes, not as plugins', () => {
  const theme = '/**\n * @id blue\n * @name Blue\n * @version 1.0.0\n * @author Ada\n * @var --accent color #3355ff Accent\n */\n.x { color: var(--accent); }\n';
  const result = checkFile('blue.theme.css', theme);
  assert.deepEqual(result.problems, []);
  // A theme has no plugin API to be compatible with, so a missing @apiVersion is not worth saying.
  assert.deepEqual(result.warnings, []);
  assert.equal(result.vars.length, 1);
  assert.match(checkFile('blue.theme.css', `${theme}.y { `).problems.join('\n'), /unbalanced/);
});

test('the bytes a signature covers survive an editor rewriting line endings', () => {
  const text = '/**\n * @id demo\n * @signature ed25519 k abc\n */\ncode();\n';
  const expected = '/**\n * @id demo\n */\ncode();\n';
  assert.equal(canonicalText(text), expected);
  assert.equal(canonicalText(text.replace(/\n/g, '\r\n')), expected);
  assert.equal(canonicalText(text.replace(/\n/g, '\r')), expected);
  // An unsigned file is its own canonical form, apart from line endings.
  assert.equal(canonicalText(expected.replace(/\n/g, '\r\n')), expected);
});

test('a malformed signature line is read as no signature rather than trusted', () => {
  for (const line of ['@signature', '@signature ed25519', '@signature ed25519 key', '@signature ed25519 key abc extra']) {
    assert.equal(readSignature(`/**\n * ${line}\n */\n`), null, line);
  }
  const good = readSignature('/**\n * @signature ed25519 key YWJj\n */\n');
  assert.deepEqual({ algorithm: good.algorithm, keyId: good.keyId, value: good.value }, { algorithm: 'ed25519', keyId: 'key', value: 'YWJj' });
});

test('signing round trips, and signing twice leaves one signature', () => {
  const keys = generateKeys();
  const text = '/**\n * @id demo\n * @name Demo\n */\nexport default { start() {} };\n';
  const signed = signText(text, { keyId: 'acme', privateKey: keys.privateKey });
  assert.equal(verifyText(signed, { acme: keys.publicKey }).state, 'valid');
  const again = signText(signed, { keyId: 'acme', privateKey: keys.privateKey });
  assert.equal(again.match(/@signature/g).length, 1);
  assert.equal(verifyText(again, { acme: keys.publicKey }).state, 'valid');
  assert.equal(canonicalText(signed), canonicalText(again));
});

test('a signature covers the metadata people are shown, not only the code', () => {
  const keys = generateKeys();
  const signed = signText('/**\n * @id demo\n * @name Demo\n * @author Ada\n */\nexport default { start() {} };\n', { keyId: 'acme', privateKey: keys.privateKey });
  const trusted = { acme: keys.publicKey };
  assert.equal(verifyText(signed.replace('start() {}', 'start() { steal(); }'), trusted).state, 'tampered');
  assert.equal(verifyText(signed.replace('@name Demo', '@name Totally Safe'), trusted).state, 'tampered');
  assert.equal(verifyText(signed.replace('@author Ada', '@author Someone Else'), trusted).state, 'tampered');
});

test('verifying tells apart unsigned, unknown keys and valid signatures', () => {
  const mine = generateKeys();
  const theirs = generateKeys();
  const signed = signText('/**\n * @id demo\n */\ncode();\n', { keyId: 'mine', privateKey: mine.privateKey });
  assert.deepEqual(verifyText('/**\n * @id demo\n */\ncode();\n', { mine: mine.publicKey }), { state: 'unsigned', keyId: null });
  assert.equal(verifyText(signed, {}).state, 'unknown');
  assert.equal(verifyText(signed, { other: theirs.publicKey }).state, 'unknown');
  assert.equal(verifyText(signed, { mine: theirs.publicKey }).state, 'tampered');
  assert.equal(verifyText(signed, { mine: mine.publicKey }).state, 'valid');
  assert.equal(verifyText('/**\n * @signature ed25519 mine not-base64!\n */\n', { mine: mine.publicKey }).state, 'tampered');
});

test('a signature on a file with no header is refused rather than written somewhere useless', () => {
  assert.throws(() => withSignature('code();\n', { algorithm: 'ed25519', keyId: 'k', value: 'v' }), /no metadata header/);
});

test('keygen makes usable, distinct keys', () => {
  const a = generateKeys();
  const b = generateKeys();
  assert.notEqual(a.privateKey, b.privateKey);
  const signed = signText('/**\n * @id demo\n */\ncode();\n', { keyId: 'a', privateKey: a.privateKey });
  assert.equal(verifyText(signed, { a: a.publicKey }).state, 'valid');
  assert.throws(() => signText(signed, { keyId: 'has space', privateKey: a.privateKey }), /must be a word/);
});

function makeClient() {
  const client = new Client({
    manifest: { id: 'test', name: 'Test', version: '1.0.0', framework: frameworkVersion, apiVersion, build: { mode: 'production' }, config: {} },
    storageBackend: new MemoryBackend(),
    loadModule: (text) => import(`data:text/javascript,${encodeURIComponent(text)}`),
    win: undefined,
  });
  client.logger.sink = silent;
  return client;
}

test('a plugin cannot tell the client how much to trust it', async () => {
  const client = makeClient();
  await client.plugins.addSource(
    [
      '/**',
      ' * @id liar',
      ' * @name Liar',
      ' * @version 1.0.0',
      ' * @author Ada',
      ' * @signature ed25519 yapin-registry AAAA',
      ' */',
      'export default { trust: "verified", verified: true, signature: "AAAA", signer: "yapin-registry", start() {} };',
    ].join('\n'),
    { file: 'liar.plugin.js' },
  );
  const info = client.plugins.info('liar');
  assert.equal(info.trust, Trust.unverified);
  assert.equal(info.name, 'Liar');
});

test('trust comes from the loader, and a plugin built in is trusted by being built in', async () => {
  const client = makeClient();
  await client.plugins.addSource('/**\n * @id checked\n * @name Checked\n */\nexport default { start() {} };', { file: 'checked.plugin.js', trust: Trust.verified });
  assert.equal(client.plugins.info('checked').trust, Trust.verified);
  client.plugins.add({ id: 'built-in', name: 'Built in' }, { source: 'bundled' });
  assert.equal(client.plugins.info('built-in').trust, Trust.bundled);
  await client.plugins.addSource('/**\n * @id dropped\n * @name Dropped\n */\nexport default { start() {} };', { file: 'dropped.plugin.js' });
  assert.equal(client.plugins.info('dropped').trust, Trust.unverified);
});
