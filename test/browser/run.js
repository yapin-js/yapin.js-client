/**
 * Runs the runtime in a real (headless) Chromium against a page with the same markup and classes as
 * Yapin’s settings menu and profile cards, and checks the parts Node can't: page injection, nav state,
 * badges, forms and toasts. Not part of `npm test` since it needs Chrome or Edge.
 *
 *   node test/browser/run.js [--screenshot out.png]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack } from '../../src/build/pack.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const browser = BROWSERS.find((p) => existsSync(p));
if (!browser) {
  console.log('No Chrome or Edge found; set CHROME_PATH. Skipping.');
  process.exit(0);
}

const entry = `
import { boot } from ${JSON.stringify(join(ROOT, 'src/runtime/boot.js').replace(/\\/g, '/'))};
const plugins = [{
  id: 'demo', name: 'Demo plugin', enabledByDefault: true,
  settings: { size: { type: 'slider', min: 1, max: 9, default: 3 }, loud: { type: 'switch' } },
  styles: '.msg { outline: 1px solid red; }',
  start(ctx) { ctx.badges.add('u1', { id: 'tester', label: 'T', description: 'Tester' }); },
}];
const themes = [{ file: 'blue.css', text: '/**\\n * @id blue\\n * @name Blue\\n * @var --accent color #3355ff Accent\\n */\\n.x{}' }];
export default (args) => boot(args, { plugins, themes, entry: { default(client) {
  client.pages.add({ id: 'custom', title: 'Custom page', render(root, ctx) { root.append(ctx.ui.heading('Custom'), ctx.ui.hint('Made by a test')); } });
} } });
`;
const runtime = pack({ entry: 'entry', root: ROOT, virtual: { entry: { code: entry, dir: ROOT } } }).code;
const manifest = {
  id: 'browser-test',
  name: 'Browser Test',
  version: '9.9.9',
  framework: '0.1.0',
  apiVersion: 1,
  build: { mode: 'production', time: new Date().toISOString() },
  git: { commit: 'abcdef1234567', shortCommit: 'abcdef1', branch: 'main', remote: 'github.com/x/y', remoteURL: 'https://github.com/x/y', commitURL: 'https://github.com/x/y/commit/abcdef1234567' },
  links: { website: 'https://example.com' },
  config: { origins: ['null', 'file://'], plugins: {}, themes: {}, pages: {}, about: {}, badges: {}, api: {}, host: {}, runtime: {} },
};

const html = `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>
:root{--bg-side:#1b1c21;--bg-main:#222329;--bg-elev:#2b2c33;--bg-hover:#2f3038;--bg-active:#383944;--bg-input:#2d2e36;--text:#ececf1;--text-muted:#9c9daa;--border:#ffffff12;--accent:#ff6b4a;--danger:#f2555a;--success:#3fcf82;--radius:10px;--shadow:0 10px 40px #0007;--bg-float:#1b1c21}
body{margin:0;background:var(--bg-main);color:var(--text);font:15px system-ui}
.settings{display:flex;height:600px}.settings-nav{background:var(--bg-side);display:flex;flex-direction:column;gap:2px;width:180px;padding:20px 10px}
.settings-nav-label{text-transform:uppercase;font-size:11px;font-weight:800;color:var(--text-muted);padding:6px 10px 4px}
.settings-nav button{text-align:left;color:var(--text-muted);border:0;background:none;border-radius:6px;padding:8px 10px;font-size:15px;display:flex;gap:8px}
.settings-nav button.active{background:var(--bg-active);color:var(--text)}
.settings-main{flex:1;padding:20px 22px}.btn{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:8px 14px}.btn.ghost{background:var(--bg-active)}.btn.small{padding:4px 10px;font-size:13px}
.input{background:var(--bg-input);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 8px}
.field{display:flex;flex-direction:column;gap:4px;margin:10px 0}.hint{color:var(--text-muted);font-size:13px}
.toggle-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)}
.switch{appearance:none;background:var(--bg-active);border-radius:12px;width:42px;height:24px;position:relative}.switch:checked{background:var(--success)}
</style></head><body>
<div class="pc-sub-row" id="profile"><div class="pc-handle"><span>@someone</span></div></div>
<div class="modal"><div class="settings">
  <nav class="settings-nav"><div class="settings-nav-label">User settings</div><button class="active" id="host-account">My Account</button><button id="host-profile">My Profile</button><div class="settings-nav-label">App settings</div><button>Appearance</button></nav>
  <section class="settings-main" id="host-main"><h2>My Account</h2></section>
</div></div>
<pre id="results">pending</pre>
<script>
document.getElementById('profile').__reactFiber$test = { memoizedProps: { className: 'x' }, return: { memoizedProps: { userId: 'u1' }, return: null } };
const client = (${runtime})().default(${JSON.stringify({ manifest, environment: { chrome: 'test' } })});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {};
(async () => {
  try {
    await client.ready;
    await sleep(50);
    const nav = document.querySelector('nav.settings-nav');
    results.navLabels = [...nav.querySelectorAll('.settings-nav-label')].map((l) => l.textContent);
    results.navItems = [...nav.querySelectorAll('[data-yc-page-id]')].map((b) => b.textContent.trim());
    nav.querySelector('[data-yc-page-id=about]').click();
    await sleep(30);
    results.hostHidden = document.getElementById('host-main').style.display === 'none';
    results.hostActiveCleared = !document.getElementById('host-account').classList.contains('active');
    results.ourActive = nav.querySelector('[data-yc-page-id=about]').classList.contains('active');
    const ours = document.querySelector('section.settings-main[data-yc-page]');
    results.aboutHeading = ours?.querySelector('h2')?.textContent;
    results.aboutRows = [...ours.querySelectorAll('dt')].map((d) => d.textContent);
    results.commitLink = ours.querySelector('a[href*="commit"]')?.textContent;
    client.about.set('app.version', { value: '10.0.0' });
    results.liveUpdate = [...ours.querySelectorAll('dd')].some((d) => d.textContent.includes('10.0.0'));

    nav.querySelector('[data-yc-page-id=plugins]').click();
    await sleep(30);
    const pluginsPage = document.querySelector('section.settings-main[data-yc-page]');
    results.pluginCard = pluginsPage.querySelector('.yc-card-title')?.textContent;
    [...pluginsPage.querySelectorAll('button')].find((b) => b.textContent === 'Settings').click();
    await sleep(20);
    const sw = pluginsPage.querySelector('.yc-form .switch');
    sw.click();
    results.switchSaved = client.plugins.get('demo').settings.get('loud') === true;

    nav.querySelector('[data-yc-page-id=themes]').click();
    await sleep(30);
    const themeSwitch = document.querySelector('section.settings-main[data-yc-page] .yc-card .switch');
    themeSwitch.click();
    results.themeEnabled = client.themes.isEnabled('blue');
    results.adoptedSheets = document.adoptedStyleSheets.length;

    document.getElementById('host-account').click();
    await sleep(30);
    results.restoredHost = document.getElementById('host-main').style.display === '' && !document.querySelector('section.settings-main[data-yc-page]');
    results.hostActiveRestored = document.getElementById('host-account').classList.contains('active');

    nav.querySelector('[data-yc-page-id=custom]').click();
    await sleep(30);
    results.customPage = document.querySelector('section.settings-main[data-yc-page] h2')?.textContent;

    results.badges = [...document.querySelectorAll('#profile .yc-badge')].map((b) => b.getAttribute('aria-label'));
    client.ui.toast('Hello from the test', { type: 'success', timeout: 0 });
    results.toast = document.querySelector('.yc-toast')?.textContent;
    document.querySelector('.modal').remove();
    await sleep(30);
    results.cleanedUp = !document.querySelector('[data-yc-nav]');
    results.errors = client.logger.history.entries.filter((e) => e.level === 'error').map((e) => e.message);
  } catch (error) {
    results.crash = String(error && error.stack || error);
  }
  document.getElementById('results').textContent = JSON.stringify(results);
})();
</script></body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'yc-browser-'));
const page = join(dir, 'index.html');
writeFileSync(page, html);
const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(dir, 'profile')}`, '--virtual-time-budget=5000', '--dump-dom', `file:///${page.replace(/\\/g, '/')}`];
const dom = execFileSync(browser, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 20_000_000 });
const match = /<pre id="results">([\s\S]*?)<\/pre>/.exec(dom);
const results = JSON.parse((match?.[1] ?? '{}').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));

const screenshotArg = process.argv.indexOf('--screenshot');
if (screenshotArg > 0) {
  const shotHTML = html.replace("document.querySelector('.modal').remove();", "nav.querySelector('[data-yc-page-id=about]').click(); await sleep(50);");
  writeFileSync(page, shotHTML);
  execFileSync(browser, [...args.filter((a) => a !== '--dump-dom' && !a.startsWith('file:')), '--window-size=1000,700', `--screenshot=${process.argv[screenshotArg + 1]}`, `file:///${page.replace(/\\/g, '/')}`], { timeout: 60_000 });
}

const expect = {
  navLabels: (v) => JSON.stringify(v) === JSON.stringify(['User settings', 'App settings', 'Browser Test']),
  navItems: (v) => JSON.stringify(v) === JSON.stringify(['About', 'Custom page', 'Plugins', 'Themes']),
  hostHidden: (v) => v === true,
  hostActiveCleared: (v) => v === true,
  ourActive: (v) => v === true,
  aboutHeading: (v) => v === 'About',
  aboutRows: (v) => Array.isArray(v) && v.includes('Version') && v.includes('Commit') && v.includes('Chromium'),
  commitLink: (v) => v === 'abcdef1',
  liveUpdate: (v) => v === true,
  pluginCard: (v) => v === 'Demo plugin',
  switchSaved: (v) => v === true,
  themeEnabled: (v) => v === true,
  adoptedSheets: (v) => v >= 3,
  restoredHost: (v) => v === true,
  hostActiveRestored: (v) => v === true,
  customPage: (v) => v === 'Custom',
  badges: (v) => JSON.stringify(v) === JSON.stringify(['T']),
  toast: (v) => typeof v === 'string' && v.includes('Hello from the test'),
  cleanedUp: (v) => v === true,
  errors: (v) => Array.isArray(v) && v.length === 0,
};
let failed = 0;
if (results.crash) {
  console.log(`✖ crashed: ${results.crash}`);
  failed++;
}
for (const [key, check] of Object.entries(expect)) {
  const pass = check(results[key]);
  if (!pass) failed++;
  console.log(`${pass ? '✔' : '✖'} ${key}${pass ? '' : `: got ${JSON.stringify(results[key])}`}`);
}
console.log(failed ? `\n${failed} browser check(s) failed` : '\nAll browser checks passed');
process.exitCode = failed ? 1 : 0;
