import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '../src/runtime/client.js';
import { MemoryBackend, Store } from '../src/runtime/storage.js';
import { Settings, normalizeSchema } from '../src/runtime/settings.js';
import { parseMeta, parseVar, idFromFile } from '../src/runtime/meta.js';
import { Patcher } from '../src/runtime/patcher.js';
import { installTurbopackHook, ModuleFinder } from '../src/runtime/modules.js';
import { ApiClient } from '../src/runtime/api.js';
import { parseTable } from '../src/runtime/badges.js';
import { variablesCSS, VARIABLE_SELECTOR } from '../src/runtime/themes.js';
import { compareVersions, debounce, parseDuration, safeURL, sortByDependencies } from '../src/runtime/util.js';
import { findUserId } from '../src/runtime/react.js';
import { Emitter } from '../src/runtime/events.js';
import { apiVersion } from '../src/shared/constants.js';

const silent = { debug() {}, log() {}, info() {}, warn() {}, error() {} };

function makeClient(config = {}, options = {}) {
  const client = new Client({
    manifest: { id: 'test', name: 'Test', version: '1.0.0', framework: '0.1.0', apiVersion, build: { mode: 'production' }, config },
    storageBackend: options.backend ?? new MemoryBackend(),
    loadModule: options.loadModule ?? ((text) => import(`data:text/javascript,${encodeURIComponent(text)}`)),
    fetch: options.fetch,
    win: undefined,
  });
  client.logger.sink = silent;
  return client;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('util helpers', () => {
  assert.equal(parseDuration('15m'), 900_000);
  assert.equal(parseDuration('bad', 5), 5);
  assert.equal(compareVersions('1.2.10', '1.2.9'), 1);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1);
  assert.equal(safeURL('javascript:alert(1)'), null);
  assert.equal(safeURL('https://x.y/a')?.href, 'https://x.y/a');
  const { sorted, problems } = sortByDependencies([{ id: 'a', dependencies: ['b'] }, { id: 'b' }, { id: 'c', dependencies: ['x'] }]);
  assert.deepEqual(sorted.map((x) => x.id), ['b', 'a']);
  assert.match(problems[0].reason, /needs "x"/);
});

test('debounce flush uses the pending arguments', async () => {
  const seen = [];
  const fn = debounce((v) => seen.push(v), 50);
  fn('a');
  fn('b');
  fn.flush();
  assert.deepEqual(seen, ['b']);
  fn('c');
  fn.flush('override');
  assert.deepEqual(seen, ['b', 'override']);
});

test('emitter isolates listener errors', () => {
  const errors = [];
  const events = new Emitter({ onError: (e) => errors.push(e) });
  const seen = [];
  events.on('x', () => {
    throw new Error('boom');
  });
  const off = events.on('x', (v) => seen.push(v));
  events.emit('x', 1);
  off();
  events.emit('x', 2);
  assert.deepEqual(seen, [1]);
  assert.equal(errors.length, 2);
});

test('store copies values and enforces JSON', () => {
  const backend = new MemoryBackend();
  const store = new Store(backend, 'ns', { delay: 0 });
  const obj = { a: [1] };
  store.set('k', obj);
  obj.a.push(2);
  assert.deepEqual(store.get('k'), { a: [1] });
  const got = store.get('k');
  got.a.push(3);
  assert.deepEqual(store.get('k'), { a: [1] });
  assert.throws(() => store.set('f', () => {}), /JSON/);
  store.flush();
  assert.deepEqual(backend.read('ns'), { k: { a: [1] } });
  assert.throws(() => new Store(backend, '../evil'), /namespace/);
});

test('settings validate, coerce and report changes', () => {
  const store = new Store(new MemoryBackend(), 's');
  const settings = new Settings(
    {
      on: { type: 'switch', default: true },
      size: { type: 'slider', min: 1, max: 10, default: 5 },
      mode: { type: 'select', options: ['a', { label: 'B', value: 'b' }] },
      color: { type: 'color', default: '#112233' },
      name: { type: 'text', maxLength: 3, trim: true },
      even: { type: 'number', default: 2, validate: (v) => v % 2 === 0 || 'must be even' },
      advanced: { type: 'switch', hidden: (s) => !s.get('on') },
    },
    store,
  );
  const changes = [];
  settings.onChange('*', (value, old, key) => changes.push([key, value, old]));
  assert.equal(settings.get('mode'), 'a');
  settings.set('size', '7');
  assert.equal(settings.get('size'), 7);
  settings.set('name', '  ab ');
  assert.equal(settings.get('name'), 'ab');
  assert.throws(() => settings.set('size', 11), /at most 10/);
  assert.throws(() => settings.set('color', 'red'), /hex/);
  assert.throws(() => settings.set('even', 3), /must be even/);
  assert.throws(() => settings.set('nope', 1), /doesn't exist/);
  assert.equal(settings.state('advanced').hidden, false);
  settings.set('on', false);
  assert.equal(settings.state('advanced').hidden, true);
  settings.reset('size');
  assert.equal(settings.get('size'), 5);
  assert.deepEqual(changes.map((c) => c[0]), ['size', 'name', 'on', 'size']);
  assert.throws(() => normalizeSchema({ x: { type: 'nope' } }, 'p'), /unknown type/);
  assert.throws(() => normalizeSchema({ x: { type: 'number', min: 5, default: 1 } }, 'p'), /default that must be at least 5/);
});

test('metadata headers and theme variables', () => {
  const { meta, vars } = parseMeta(`/**
 * @id cool-theme
 * @name Cool Theme
 * @author Ada <https://ada.dev>, Bob
 * @tags dark, blue
 * @apiVersion 1
 * @var --accent color #7c5cff Accent colour
 * @var --radius number 8 Corners | min=0 max=24 unit=px
 * @var --density select comfy "Density level" | options=compact,comfy
 * @custom something
 */
.x{}`);
  assert.equal(meta.id, 'cool-theme');
  assert.deepEqual(meta.authors, [{ name: 'Ada', url: 'https://ada.dev' }, { name: 'Bob' }]);
  assert.deepEqual(meta.tags, ['dark', 'blue']);
  assert.equal(meta.apiVersion, 1);
  assert.equal(meta.extra.custom, 'something');
  assert.equal(vars.length, 3);
  assert.deepEqual(vars[1], { variable: '--radius', type: 'number', default: 8, label: 'Corners', min: 0, max: 24, unit: 'px' });
  assert.deepEqual(vars[2].options, ['compact', 'comfy']);
  assert.equal(vars[2].label, 'Density level');
  assert.equal(parseVar('nope'), null);
  assert.equal(idFromFile('C:/x/My Theme.theme.css'), 'my-theme');
});

test('patcher stacks, removes in any order and survives throwing patches', () => {
  const errors = [];
  const patcher = new Patcher({ onError: (e) => errors.push(e) });
  const obj = { add: (a, b) => a + b };
  const original = obj.add;
  const u1 = patcher.before(obj, 'add', (args) => [args[0] * 10, args[1]]);
  const u2 = patcher.after(obj, 'add', (_args, result) => result + 1, { owner: 'p' });
  const u3 = patcher.instead(obj, 'add', (args, orig) => orig(...args) * 2);
  patcher.after(obj, 'add', () => {
    throw new Error('bad patch');
  });
  assert.equal(obj.add(1, 2), 25);
  assert.equal(errors.length, 1);
  assert.equal(obj.add.toString(), original.toString());
  u3();
  assert.equal(obj.add(1, 2), 13);
  assert.equal(patcher.unpatchAll('p'), 1);
  u1();
  u2();
  assert.equal(obj.add(1, 2), 3);
});

test('turbopack hook captures modules before and after the runtime swaps in', () => {
  const g = {};
  const hook = installTurbopackHook(g);
  (g.TURBOPACK || (g.TURBOPACK = [])).push([null, 1, (ctx) => (ctx.m.exports = { useStore: 1, getState: 2 })]);
  const cache = new Map();
  const load = (chunk) => {
    for (let i = 1; i < chunk.length; i += 2) {
      const m = { exports: {} };
      cache.set(chunk[i], m);
      chunk[i + 1]({ c: cache, m });
    }
  };
  const before = g.TURBOPACK;
  g.TURBOPACK = { push: load };
  before.forEach(load);
  const finder = new ModuleFinder(hook);
  const waiting = finder.waitFor(finder.filters.byProps('later'));
  g.TURBOPACK.push([null, 2, function factory(ctx) { ctx.m.exports = { default: function Settings() { return 'marker-123'; }, later: true }; }]);
  assert.equal(finder.available, true);
  assert.deepEqual(finder.findByProps('useStore', 'getState'), { useStore: 1, getState: 2 });
  assert.equal(finder.findByCode('marker-123').name, 'Settings');
  assert.ok(finder.findModuleByCode('marker-123'));
  assert.equal(installTurbopackHook(g), hook, 'installing twice reuses the hook');
  return waiting.then((found) => assert.equal(found.later, true));
});

test('api client: allowlist, services, retries, cache and errors', async () => {
  const calls = [];
  let fail = 2;
  const fetch = async (url, init) => {
    calls.push([init.method, url, init.headers]);
    if (url.includes('/flaky') && fail-- > 0) return new Response('busy', { status: 503, headers: { 'retry-after': '0' } });
    if (url.includes('/missing')) return new Response(JSON.stringify({ message: 'nope' }), { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ ok: true, url }), { headers: { 'content-type': 'application/json' } });
  };
  const store = new Map();
  const api = new ApiClient({
    services: { backend: { baseURL: 'https://api.example.com/v1', auth: { secret: 'token' } } },
    allowedOrigins: ['https://api.example.com'],
    fetch,
    secrets: { get: async (name) => (name === 'token' ? 'abc' : store.get(name)) },
  });
  const backend = api.service('backend');
  const res = await backend.get('/me', { query: { a: 1, b: [2, 3] } });
  assert.equal(res.url, 'https://api.example.com/v1/me?a=1&b=2&b=3');
  assert.equal(calls[0][2].authorization, 'Bearer abc');
  assert.deepEqual(await backend.get('/flaky'), { ok: true, url: 'https://api.example.com/v1/flaky' });
  await assert.rejects(backend.get('/missing'), (e) => e.status === 404 && /nope/.test(e.message));
  await assert.rejects(api.request({ url: 'https://evil.example/x' }), /isn't an allowed API origin/);
  assert.throws(() => api.addService('evil', { baseURL: 'https://evil.example' }), /allowedOrigins/);
  const count = calls.length;
  await backend.get('/cached', { cache: '1m' });
  await backend.get('/cached', { cache: '1m' });
  assert.equal(calls.length, count + 1);
  await backend.post('/things', { json: { a: 1 } });
  assert.equal(calls.at(-1)[2]['content-type'], 'application/json');
});

test('badge tables and sanitising', () => {
  const table = parseTable({ badges: { dev: { label: 'Dev', icon: 'https://x.y/dev.png' } }, users: { 1: ['dev', { id: 'own', label: 'Own' }, 'unknown'] } });
  assert.equal(table.get('1').length, 2);
  const client = makeClient();
  assert.equal(client.badges.normalize({ id: 'x', label: 'X', icon: 'javascript:alert(1)', href: 'http://x.y' }, 'p').icon, null);
  assert.equal(client.badges.normalize({ id: 'x', label: 'X', href: 'http://x.y' }, 'p').href, null);
  assert.equal(client.badges.normalize({ id: 'x', icon: 'https://x.y/i.png' }, 'p').icon.src, 'https://x.y/i.png');
  assert.equal(client.badges.normalize({ id: 'x' }, 'p'), null);
});

test('badges from providers and code, deduplicated and capped', async () => {
  const client = makeClient({ badges: { max: 3 } });
  client.badges.addProvider({ id: 'code', get: async (userId) => (userId === 'u1' ? [{ id: 'a', label: 'A' }, { id: 'a', label: 'dupe' }] : []) });
  client.badges.addProvider({ id: 'table', load: async () => ({ users: { u1: [{ id: 'b', label: 'B' }, { id: 'c', label: 'C' }] } }) });
  await tick();
  const remove = client.badges.add('u1', { id: 'static', label: 'S', priority: 10 });
  const badges = await client.badges.for('u1');
  assert.deepEqual(badges.map((b) => b.id), ['static', 'a', 'b']);
  remove();
  assert.equal((await client.badges.for('u1')).some((b) => b.id === 'static'), false);
  assert.throws(() => client.badges.addProvider({ id: 'code', get() {} }), /already exists/);
});

test('react helpers find user ids up the fiber tree', () => {
  const parent = { memoizedProps: { profile: { id: 'user-9' } }, return: null };
  const child = { memoizedProps: { className: 'x' }, return: parent };
  const node = { __reactFiber$abc: child };
  assert.equal(findUserId(node, ['userId', 'profile.id']), 'user-9');
  assert.equal(findUserId({}, ['userId']), null);
});

test('theme variables css uses a selector that beats Yapin’s own', () => {
  const css = variablesCSS({ '--accent': '#fff', '--bad': 'x; } body { display:none', dark: { '--bg': '#000' }, light: { '--bg': '#fff' } });
  assert.match(css, new RegExp(`^${VARIABLE_SELECTOR.replace(/:/g, ':')} \\{\\n  --accent: #fff;`));
  assert.ok(!css.includes('display:none'));
  assert.match(css, /:not\(\[data-theme=light\]\)/);
  assert.match(css, /\[data-theme=light\] \{\n  --bg: #fff;/);
});

test('plugins: lifecycle, settings, dependencies, cleanup, crash limit', async () => {
  const client = makeClient({ plugins: { crash: { limit: 2, window: 60_000 }, required: ['core'] } });
  const log = [];
  client.plugins.add({ id: 'core', name: 'Core', start: () => log.push('core start') }, { source: 'bundled' });
  client.plugins.add(
    {
      id: 'feature',
      name: 'Feature',
      dependencies: ['core'],
      settings: { level: { type: 'number', default: 1 } },
      events: { custom: () => log.push('event') },
      start(ctx) {
        log.push(`feature start ${ctx.settings.get('level')}`);
        ctx.on('boom', () => {
          throw new Error('handler failed');
        });
        ctx.onStop(() => log.push('feature cleanup'));
      },
      onSettingsChange: (key, value) => log.push(`${key}=${value}`),
    },
    { source: 'bundled' },
  );
  client.plugins.add({ id: 'future', name: 'Future', apiVersion: apiVersion + 1 }, { source: 'bundled' });
  await client.plugins.startAll();
  assert.equal(client.plugins.isRunning('core'), true, 'required plugins always run');
  assert.equal(client.plugins.isRunning('feature'), false, 'not enabled by default');
  await client.plugins.enable('feature');
  assert.equal(client.plugins.isRunning('feature'), true);
  client.events.emit('custom');
  client.plugins.get('feature').settings.set('level', 5);
  assert.deepEqual(log, ['core start', 'feature start 1', 'event', 'level=5']);
  assert.equal(client.plugins.info('future').compatible, false);
  await assert.rejects(client.plugins.enable('future'), /plugin API/);
  await assert.rejects(client.plugins.disable('core'), /required/);

  client.events.emit('boom');
  assert.equal(client.plugins.isRunning('feature'), true);
  client.events.emit('boom');
  assert.equal(client.plugins.info('feature').status, 'crashed');
  assert.ok(log.includes('feature cleanup'));
  assert.equal(client.events.listenerCount('custom'), 0, 'listeners are removed when the plugin stops');

  await client.plugins.restart('feature');
  await client.plugins.disable('feature');
  assert.equal(client.plugins.isEnabled('feature'), false);
  assert.throws(() => client.plugins.add({ id: 'Bad Id' }), /lowercase/);
  assert.throws(() => client.plugins.add({ id: 'core' }, { source: 'user' }), /already exists/);
});

test('plugins from source text, with the header filling in metadata', async () => {
  const client = makeClient();
  await client.plugins.addSource(`/**\n * @id from-text\n * @name From Text\n * @version 2.0.0\n * @author Ada\n */\nexport default { start() { globalThis.__fromText = true; } };`, { file: 'from-text.plugin.js' });
  const info = client.plugins.info('from-text');
  assert.equal(info.name, 'From Text');
  assert.equal(info.version, '2.0.0');
  assert.equal(info.source, 'user');
  await client.plugins.startAll();
  await client.plugins.enable('from-text');
  assert.equal(globalThis.__fromText, true);
  await client.plugins.addSource('export default (client) => ({ id: "factory", name: client.name + " factory" });', { file: 'factory.js' });
  assert.equal(client.plugins.info('factory').name, 'Test factory');
  await assert.rejects(client.plugins.addSource('export default 42;', { file: 'x.js' }), /doesn't export a plugin/);
});

test('security: the client app sets the floor, the person can only go stricter', () => {
  const asked = makeClient();
  assert.equal(asked.security.shouldConfirm('plugins'), true);
  assert.equal(asked.security.shouldConfirm('themes'), true);
  // confirmInstall: 'always' locks the setting on, so turning it off changes nothing.
  assert.equal(asked.security.settings.state('confirmEveryInstall').disabled, true);
  asked.security.settings.set('confirmEveryInstall', false);
  assert.equal(asked.security.shouldConfirm('themes'), true);

  const lenient = makeClient({ security: { confirmInstall: 'plugins' } });
  assert.equal(lenient.security.settings.state('confirmEveryInstall').disabled, false);
  assert.equal(lenient.security.shouldConfirm('themes'), true, 'the person is asked until they say otherwise');
  lenient.security.settings.set('confirmEveryInstall', false);
  assert.equal(lenient.security.shouldConfirm('themes'), false);
  assert.equal(lenient.security.shouldConfirm('plugins'), true, 'plugins are always confirmed');
});

test('security: authors the person trusts, and the ones the client app vouches for', () => {
  const client = makeClient({ security: { trustedAuthors: [{ name: 'Core Team', url: 'https://example.com' }] } });
  const { security } = client;
  assert.equal(security.trustsAuthors([{ name: 'Ada' }]), false);
  assert.equal(security.trustsAuthors([]), false, 'no author is never trusted');
  assert.equal(security.trustsAuthors([{ name: 'core team' }]), true, 'vouched for by the client app, whatever the case');
  assert.equal(security.isVouchedAuthor('Core Team'), true);

  security.trustAuthors([{ name: 'Ada', url: 'https://ada.dev' }, { name: 'Bo' }]);
  assert.equal(security.trustsAuthors([{ name: 'Ada' }, { name: 'Bo' }]), true);
  assert.equal(security.trustsAuthors([{ name: 'Ada' }, { name: 'Cy' }]), false, 'one stranger is enough to ask again');
  assert.deepEqual(security.trustedAuthors().map((a) => a.name), ['Bo', 'Ada']);
  assert.ok(security.trustedAt('Ada'));
  // Vouched authors aren't written into the person's own list.
  security.trustAuthors([{ name: 'Core Team' }]);
  assert.deepEqual(security.trustedAuthors().map((a) => a.name), ['Bo', 'Ada']);

  security.forgetAuthor('Bo');
  assert.deepEqual(security.trustedAuthors().map((a) => a.name), ['Ada']);
  security.settings.set('rememberAuthors', false);
  assert.deepEqual(security.trustedAuthors(), [], 'turning remembering off forgets what was remembered');
  assert.equal(security.trustsAuthors([{ name: 'Ada' }]), false);
  assert.equal(security.trustsAuthors([{ name: 'Core Team' }]), true, 'the client app still vouches');

  const noMemory = makeClient({ security: { rememberAuthors: false } });
  assert.equal(noMemory.security.remembersAuthors, false);
  assert.deepEqual(noMemory.security.trustAuthors([{ name: 'Ada' }]), []);
  assert.equal(noMemory.security.settings.state('rememberAuthors').hidden, true);
});

test('security: installing notes where it came from, and the person can turn links off', async () => {
  const client = makeClient();
  const source = `/**\n * @id gift\n * @name Gift\n * @version 1.0.0\n * @author Ada <https://ada.dev>\n */\nexport default { start() {} };`;
  assert.equal(client.userContent.canInstallFromURL('plugins'), true);

  assert.equal(await client.userContent.install('plugins', { text: source, confirm: false }), 'gift');
  const record = client.security.installRecord('plugins', 'gift');
  assert.equal(record.name, 'Gift');
  assert.deepEqual(record.authors, ['Ada']);
  assert.equal(record.url, null);
  assert.ok(record.at);
  assert.deepEqual(client.security.installs().map((entry) => entry.id), ['gift']);

  await client.userContent.uninstall('plugins', 'gift');
  assert.equal(client.security.installRecord('plugins', 'gift'), null);

  client.security.settings.set('installFromLinks', false);
  assert.equal(client.userContent.canInstallFromURL('plugins'), false);
  await assert.rejects(client.userContent.install('plugins', { url: 'https://example.com/a.plugin.js' }), /turned off in your security settings/);
  assert.equal(await client.userContent.install('plugins', { text: source, confirm: false }), 'gift', 'files still work');

  const noLinks = makeClient({ plugins: { user: { install: { url: false } } } });
  assert.equal(noLinks.userContent.canInstallFromURL('plugins'), false);
  await assert.rejects(noLinks.userContent.install('plugins', { url: 'https://example.com/a.plugin.js' }), /doesn't allow installing plugins from links/);
});

test('safe mode starts nothing', async () => {
  const client = makeClient();
  client.safeMode = true;
  client.plugins.add({ id: 'x', enabledByDefault: true, start: () => assert.fail('should not start') });
  assert.deepEqual(await client.plugins.startAll(), []);
});

test('themes: enable state, single-theme mode and variable settings', () => {
  const client = makeClient({ themes: { multiple: false } });
  client.themes.start();
  const theme = client.themes.parse(`/**\n * @id one\n * @name One\n * @var --accent color #111111 Accent\n */\n.a{}`, { file: 'one.css', source: 'bundled' });
  client.themes.add(theme, { source: 'bundled' });
  client.themes.add({ id: 'two', name: 'Two', css: '.b{}' });
  client.themes.enable('one');
  client.themes.enable('two');
  assert.deepEqual(client.themes.enabledIds, ['two'], 'only one theme at a time');
  const settings = client.themes.settings('one');
  settings.set('accent', '#222222');
  assert.equal(settings.get('accent'), '#222222');
  assert.ok(client.themes.list().find((t) => t.id === 'one').hasSettings);
  client.themes.customCSS = '.c{}';
  assert.equal(client.themes.customCSS, '.c{}');
  assert.throws(() => client.themes.add({ id: 'bad' }), /needs css or variables/);
});

test('pages: add, update, remove, owners', () => {
  const client = makeClient();
  const page = client.pages.add({ id: 'extra', title: 'Extra', render: () => {} }, { owner: 'me' });
  assert.equal(client.pages.has('extra'), true);
  page.update({ title: 'Renamed', section: 'tools' });
  assert.equal(client.pages.list().find((p) => p.id === 'extra').title, 'Renamed');
  assert.ok(client.pages.sections().some((s) => s.id === 'tools'));
  assert.throws(() => client.pages.add({ id: 'extra', render() {} }), /already exists/);
  assert.throws(() => client.pages.add({ id: 'no-render' }), /render/);
  client.pages.removeOwned('me');
  assert.equal(client.pages.has('extra'), false);
});

test('the about page: defaults, config edits and code edits', async () => {
  const client = makeClient({ about: { fields: { 'build.framework': false, 'links.docs': { label: 'Docs', value: 'https://docs.example', href: 'https://docs.example' } }, sections: { environment: false } } });
  assert.equal(client.about.get('app.version').value, '1.0.0');
  assert.equal(client.about.get('build.framework'), null);
  assert.equal(client.about.get('links.docs').label, 'Docs');
  assert.equal(client.about.fields().some((f) => f.section === 'environment'), false);
  client.about.set('support.discord', { label: 'Community', value: 'https://example.com/chat' });
  assert.match(client.about.debugInfo(), /Community: https:\/\/example\.com\/chat/);
  assert.throws(() => client.about.set('nodot', {}), /section\.name/);
  const layouts = Object.fromEntries(client.about.sections().map((s) => [s.id, s.layout]));
  assert.equal(layouts.app, 'header');
  assert.equal(layouts.build, 'rows');
  assert.equal(layouts.support, 'rows', 'a new section defaults to rows');
  client.about.section('build', { layout: 'chips' });
  assert.equal(client.about.sections().find((s) => s.id === 'build').layout, 'chips');
  client.about.section('build', { title: 'Made' });
  assert.equal(client.about.sections().find((s) => s.id === 'build').layout, 'chips', 'changing the title keeps the layout');
  client.about.section('build', { layout: 'nonsense' });
  assert.equal(client.about.sections().find((s) => s.id === 'build').layout, 'chips', 'an unknown layout is ignored');
  const fromConfig = makeClient({ about: { sections: { links: { layout: 'rows' }, app: { layout: 'rows' } } } });
  assert.deepEqual(fromConfig.about.sections().filter((s) => ['app', 'links'].includes(s.id)).map((s) => s.layout), ['rows', 'rows']);
  const disabled = makeClient({ about: false });
  assert.equal(disabled.about, null);
  await disabled.start();
  assert.equal(disabled.pages.has('about'), false);
});

test('welcome and what\'s new: seen tracking, entries gate, disabling', async () => {
  const client = makeClient({ whatsNew: { entries: [{ title: 'New thing' }] } });
  assert.equal(client.welcome.shouldShow(), true);
  assert.equal(client.whatsNew.shouldShow(), true);
  client.welcome.markSeen();
  assert.equal(client.welcome.shouldShow(), false);
  client.welcome.reset();
  assert.equal(client.welcome.shouldShow(), true);
  client.whatsNew.markSeen();
  assert.equal(client.whatsNew.shouldShow(), false);

  const noEntries = makeClient({});
  assert.equal(noEntries.whatsNew.shouldShow(), false);

  const disabled = makeClient({ welcome: false, whatsNew: { enabled: false, entries: [{ title: 'x' }] } });
  assert.equal(disabled.welcome, null);
  assert.equal(disabled.whatsNew.shouldShow(), false);
});

test('client start: a fresh run marks what\'s new seen without showing it', async () => {
  const client = makeClient({ whatsNew: { entries: [{ title: 'New thing' }] } });
  assert.equal(client.whatsNew.shouldShow(), true);
  await client.start();
  assert.equal(client.whatsNew.shouldShow(), false, 'the first run should not also show what\'s new');
});

test('client start: entry, bundled plugins and themes, ready event', async () => {
  const client = makeClient({ badges: { sources: [] } });
  const order = [];
  client.events.on('ready', () => order.push('ready'));
  await client.start({
    entry: { default: (c) => order.push(`setup ${c.name}`) },
    plugins: [{ id: 'auto', enabledByDefault: true, start: () => order.push('plugin') }],
    themes: [{ file: 'base.css', text: '/**\n * @id base\n */\n.x{}' }],
  });
  assert.deepEqual(order, ['setup Test', 'plugin', 'ready']);
  assert.equal(client.isReady, true);
  assert.ok(client.themes.has('base'));
  assert.deepEqual(client.pages.list().map((p) => p.id), ['about', 'plugins', 'themes', 'security']);
});
