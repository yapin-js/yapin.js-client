#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadConfig } from '../src/config/load.js';
import { build } from '../src/build/build.js';
import { pack } from '../src/build/pack.js';
import { findInstalls, install, inspect, repair, uninstall } from '../src/installer/patch.js';
import { closeApp, isRunning, launchApp } from '../src/installer/processes.js';
import { defaultTarget } from '../src/installer/paths.js';
import { parseMeta } from '../src/runtime/meta.js';
import { normalizeSchema } from '../src/runtime/settings.js';
import { style } from '../src/installer/cli.js';
import { deepMerge } from '../src/runtime/util.js';
import { apiVersion, version } from '../src/shared/constants.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const HELP = `yapin-client ${version}: build Yapin’ client apps

Usage: yapin-client <command> [options]

Commands:
  init [dir]             Start a new client app (config, entry, folders)
  build                  Build the payload, installer, zip and userscript into dist/
  dev                    Build in development mode, install into the desktop app, rebuild on save
  install                Install the built client app into the desktop app on this computer
  uninstall [--purge]    Remove it again (--purge deletes its data too)
  repair                 Put it back after the desktop app updated
  status                 Show desktop installs and what's installed in them
  pack <file> [-o out]   Bundle a plugin with its imports into one file
  validate <file>        Check a plugin (.js) or theme (.css) file
  doctor                 Check the project and this computer for problems

Options:
  -c, --config <file>    Config file (default: yapin-client.config.js|.mjs|.json)
  --mode <mode>          production (default) or development
  --path <dir>           Desktop app folder, if it isn't found on its own
  --close                Close the desktop app without asking when it's running
  --no-installer         build: skip the installer and zip
  -h, --help             Show this
  -v, --version          Show the version`;

const ok = (text) => console.log(style.green(`✔ ${text}`));
const warn = (text) => console.log(style.yellow(`! ${text}`));
const info = (text) => console.log(style.dim(`  ${text}`));

function fail(error) {
  console.error(style.red(`✖ ${error?.message ?? error}`));
  if (error?.hint) console.error(`  ${error.hint}`);
  if (process.env.DEBUG && error?.stack) console.error(style.dim(error.stack));
  process.exitCode = 1;
}

async function load(values, mode) {
  if (mode) process.env.YAPIN_CLIENT_MODE = mode;
  const loaded = await loadConfig({ file: values.config });
  for (const warning of loaded.warnings) warn(warning);
  return loaded;
}

function target(config) {
  return deepMerge(structuredClone(defaultTarget), config.installer.target ?? {});
}

function pickInstall(config, values) {
  const list = findInstalls({ target: target(config), extra: values.path ?? [] });
  if (!list.length) throw Object.assign(new Error("Couldn't find the desktop app"), { hint: 'Install it from https://www.yapin.gg, or pass --path <folder>.' });
  const found = list[0];
  if (!found.fuseCheck.ok) throw new Error(found.fuseCheck.reason);
  return found;
}

async function ensureClosed(config, values) {
  const t = target(config);
  const name = t.processName?.[process.platform];
  if (!name || !(await isRunning(name))) return false;
  if (!values.close) throw Object.assign(new Error(`${t.productName} is running`), { hint: 'Close it, or pass --close to let yapin-client close it.' });
  info(`Closing ${t.productName}…`);
  if (!(await closeApp(name))) throw new Error(`Couldn't close ${t.productName}`);
  return true;
}

async function runBuild(values, mode = values.mode ?? 'production') {
  const { config, root } = await load(values, mode);
  console.log(`${style.bold(style.accent(config.name))} ${style.dim(config.version)} ${style.dim(`(${mode})`)}`);
  const result = await build(config, { root, mode, installer: !values['no-installer'], onStep: info });
  for (const warning of result.warnings) warn(warning);
  ok(`Built in ${result.ms} ms: ${result.plugins.length} bundled plugin(s), ${result.themes.length} bundled theme(s), ${Math.round(readFileSync(join(result.payloadDir, 'runtime.js')).length / 1024)} kB runtime`);
  info(`payload     ${relative(process.cwd(), result.payloadDir)}`);
  if (result.installerDir) info(`installer   ${relative(process.cwd(), result.installerDir)}`);
  if (result.exeFile) info(`windows     ${relative(process.cwd(), result.exeFile)}`);
  if (result.zipFile) info(`zip         ${relative(process.cwd(), result.zipFile)}`);
  if (result.userscriptFile) info(`userscript  ${relative(process.cwd(), result.userscriptFile)}`);
  return { config, root, result };
}

const commands = {
  async init(values, [dir = '.']) {
    const root = resolve(dir);
    mkdirSync(root, { recursive: true });
    const existing = readdirSync(root).filter((f) => !f.startsWith('.'));
    if (existing.some((f) => f.startsWith('yapin-client.config'))) throw new Error(`${root} already has a yapin-client config`);
    const id = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-client';
    const name = id.replace(/(^|-)([a-z])/g, (_, dash, c) => `${dash ? ' ' : ''}${c.toUpperCase()}`);
    const templates = join(HERE, '..', 'templates', 'init');
    cpSync(templates, root, { recursive: true, force: false, errorOnExist: false, filter: (src) => basename(src) !== 'gitignore' });
    if (!existsSync(join(root, '.gitignore'))) writeFileSync(join(root, '.gitignore'), readFileSync(join(templates, 'gitignore')));
    for (const file of ['yapin-client.config.js', 'installer/marketing.json', 'README.md', 'src/index.js']) {
      const path = join(root, file);
      if (existsSync(path)) writeFileSync(path, readFileSync(path, 'utf8').replaceAll('__ID__', id).replaceAll('__NAME__', name));
    }
    if (!existsSync(join(root, 'package.json'))) {
      writeFileSync(
        join(root, 'package.json'),
        `${JSON.stringify({ name: id, version: '0.1.0', private: true, type: 'module', scripts: { build: 'yapin-client build', dev: 'yapin-client dev', status: 'yapin-client status' }, devDependencies: { 'yapin.js-client': `^${version}` } }, null, 2)}\n`,
      );
    }
    ok(`Created ${name} in ${root}`);
    info('Next: npm install, then npm run build (or npm run dev to try it in the desktop app)');
  },

  async build(values) {
    await runBuild(values);
  },

  async dev(values) {
    let { config, root, result } = await runBuild(values, 'development');
    const found = pickInstall(config, values);
    const wasRunning = await ensureClosed(config, values);
    install({ resources: found.resources, payload: result.payloadDir, target: target(config), onStep: info });
    ok(`Installed into ${found.location} (development build: the window reloads when you save)`);
    if (wasRunning && found.executable) launchApp(found.executable);
    const ignore = [config.outDir, join(root, 'node_modules'), join(root, '.git')];
    let timer = null;
    let building = false;
    watch(root, { recursive: true }, (_event, file) => {
      if (!file) return;
      const full = join(root, file);
      if (ignore.some((dir) => full.startsWith(dir))) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (building) return;
        building = true;
        try {
          ({ config, root, result } = await runBuild({ ...values, 'no-installer': true }, 'development'));
          install({ resources: found.resources, payload: result.payloadDir, target: target(config) });
          ok('Reinstalled; the desktop app reloads');
        } catch (error) {
          fail(error);
          process.exitCode = 0;
        } finally {
          building = false;
        }
      }, 200);
    });
    info('Watching for changes. Press Ctrl+C to stop.');
  },

  async install(values) {
    const { config } = await load(values);
    const payload = join(config.outDir, 'payload');
    if (!existsSync(join(payload, 'manifest.json'))) throw Object.assign(new Error('Nothing built yet'), { hint: 'Run yapin-client build first.' });
    const found = pickInstall(config, values);
    const wasRunning = await ensureClosed(config, values);
    const result = install({ resources: found.resources, payload, target: target(config), onStep: info });
    ok(`${config.name} ${config.version} installed into ${found.location}`);
    info(`data: ${result.dataDir}`);
    if (wasRunning && found.executable) launchApp(found.executable);
  },

  async uninstall(values) {
    const { config } = await load(values);
    const found = pickInstall(config, values);
    const wasRunning = await ensureClosed(config, values);
    const result = uninstall({ resources: found.resources, target: target(config), id: config.id, purge: Boolean(values.purge), onStep: info });
    if (result.removed) ok(`Removed${result.purged ? ' (data deleted too)' : ''}`);
    else info(result.reason);
    if (wasRunning && found.executable) launchApp(found.executable);
  },

  async repair(values) {
    const { config } = await load(values);
    const found = pickInstall(config, values);
    const wasRunning = await ensureClosed(config, values);
    const result = repair({ resources: found.resources, target: target(config), id: config.id, onStep: info });
    if (result.repaired === false) info(result.reason);
    else ok('Repaired');
    if (wasRunning && found.executable) launchApp(found.executable);
  },

  async status(values) {
    let t = defaultTarget;
    try {
      t = target((await load(values)).config);
    } catch {
      // no config here; show installs anyway
    }
    const list = findInstalls({ target: t, extra: values.path ?? [] });
    if (!list.length) return warn("Couldn't find the desktop app");
    for (const found of list) {
      const s = found.status;
      const what = s.state === 'installed' ? style.green(`${s.marker.name} ${s.marker.version}`) : s.state === 'clean' ? style.dim('nothing installed') : style.yellow(`${s.state}${s.reason ? `: ${s.reason}` : ''}`);
      console.log(`${found.location} ${style.dim(s.version ?? '')}  ${what}`);
      if (!found.fuseCheck.ok) warn(found.fuseCheck.reason);
    }
    const name = t.processName?.[process.platform];
    if (name) info(`${t.productName} is ${(await isRunning(name)) ? 'running' : 'not running'}`);
  },

  async pack(values, [file]) {
    if (!file) throw new Error('Usage: yapin-client pack <file> [-o out.js]');
    const entry = resolve(file);
    const out = resolve(values.out ?? join(dirname(entry), `${basename(entry).replace(/\.(m?js)$/, '')}.bundle.js`));
    const header = readFileSync(entry, 'utf8').match(/^\s*\/\*\*?[\s\S]*?\*\//)?.[0] ?? '';
    const result = pack({ entry, format: 'function', root: dirname(entry), alias: { 'yapin.js-client/runtime': join(HERE, '..', 'src', 'runtime', 'index.js') } });
    writeFileSync(out, `${header}\n// Bundled by yapin-client pack. Edit the source, not this file.\nconst __bundle = ${result.code}();\nexport default __bundle.default;\n`);
    ok(`${relative(process.cwd(), out)} (${result.files.length} files, ${Math.round(result.code.length / 1024)} kB)`);
  },

  async validate(_values, [file]) {
    if (!file) throw new Error('Usage: yapin-client validate <plugin.js | theme.css>');
    const text = readFileSync(resolve(file), 'utf8');
    const { meta, vars } = parseMeta(text);
    const problems = [];
    if (!meta.id) problems.push('no @id in the header (the file name will be used)');
    else if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(meta.id)) problems.push(`@id "${meta.id}" must be lowercase letters, digits and dashes`);
    if (!meta.name) problems.push('no @name');
    if (!meta.version) problems.push('no @version');
    if (!meta.authors?.length) problems.push('no @author');
    if (meta.apiVersion && meta.apiVersion > apiVersion) problems.push(`@apiVersion ${meta.apiVersion} is newer than this framework's (${apiVersion})`);
    if (/\.css$/i.test(file)) {
      try {
        const schema = Object.fromEntries(vars.map((v) => [v.variable.replace(/^--/, ''), { ...v, type: v.type === 'color' || v.type === 'number' || v.type === 'slider' || v.type === 'select' || v.type === 'switch' ? v.type : 'text', options: v.options ?? (v.type === 'select' ? [v.default] : undefined) }]));
        normalizeSchema(schema, file);
      } catch (error) {
        problems.push(error.message);
      }
      let depth = 0;
      for (const c of text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '')) {
        if (c === '{') depth++;
        if (c === '}') depth--;
        if (depth < 0) break;
      }
      if (depth !== 0) problems.push('unbalanced { } braces');
    } else {
      try {
        pack({ entry: resolve(file), root: dirname(resolve(file)), alias: { 'yapin.js-client/runtime': join(HERE, '..', 'src', 'runtime', 'index.js') } });
      } catch (error) {
        problems.push(error.message);
      }
    }
    if (problems.length) {
      for (const p of problems) warn(p);
      process.exitCode = 1;
    } else ok(`${meta.name ?? file} looks good${vars.length ? ` (${vars.length} variables)` : ''}`);
  },

  async doctor(values) {
    console.log(`yapin-client ${version} on Node ${process.versions.node} (${process.platform} ${process.arch})`);
    let config = null;
    try {
      ({ config } = await load(values));
      ok(`Config is valid: ${config.name} ${config.version}`);
    } catch (error) {
      fail(error);
    }
    const list = findInstalls({ target: config ? target(config) : defaultTarget, extra: values.path ?? [] });
    if (!list.length) warn("Desktop app not found (pass --path if it's somewhere unusual)");
    for (const found of list) {
      ok(`Desktop app at ${found.location} (${found.status.version ?? 'unknown version'}, ${found.status.state})`);
      if (!found.fuseCheck.ok) warn(found.fuseCheck.reason);
      else if (found.fuses) info(`fuses: ${Object.entries(found.fuses.fuses).filter(([, on]) => on).map(([n]) => n).join(', ') || 'none on'}`);
      if (found.status.state === 'installed') info(`installed: ${found.status.marker.name} ${found.status.marker.version}`);
      const s = inspect(found.resources, { target: config ? target(config) : defaultTarget });
      if (s.state === 'needs-repair') warn(`${s.reason}; run yapin-client repair`);
    }
    if (config) {
      for (const origin of config.origins) {
        try {
          const res = await fetch(origin, { method: 'GET', redirect: 'follow' });
          const csp = res.headers.get('content-security-policy');
          if (csp) warn(`${origin} now sends a Content-Security-Policy; user plugins may need desktop.csp: "relax" (see docs/security.md)`);
          else ok(`${origin} reachable, no Content-Security-Policy`);
        } catch (error) {
          warn(`${origin} not reachable: ${error.message}`);
        }
      }
    }
  },
};

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      mode: { type: 'string' },
      path: { type: 'string', multiple: true },
      close: { type: 'boolean' },
      purge: { type: 'boolean' },
      out: { type: 'string', short: 'o' },
      'no-installer': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.version) return console.log(version);
  const [command, ...rest] = positionals;
  if (values.help || !command) return console.log(HELP);
  const run = commands[command];
  if (!run) throw new Error(`Unknown command "${command}". Run yapin-client --help`);
  await run(values, rest);
}

main().catch(fail);
