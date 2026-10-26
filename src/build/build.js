import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pack } from './pack.js';
import { readGitInfo } from './git.js';
import { zipDirectory } from './zip.js';
import { compileLauncher, createSetupExe, findCsc, PREBUILT_LAUNCHER, signFile } from './windows.js';
import { buildNsisExe, findMakensis } from './nsis.js';
import { defaultTarget } from '../installer/paths.js';
import { deepMerge } from '../runtime/util.js';
import { apiVersion, version as frameworkVersion } from '../shared/constants.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const BUILD_MARKER = '.yapin-client-build';
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function toPosix(p) {
  return p.split(sep).join('/');
}

/** Plugin files in a folder: `name.js` / `name.mjs`, or `name/index.js`. Names starting with _ or . are skipped. */
export function findPlugins(dirs) {
  const out = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (/^[_.]/.test(name)) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        const index = ['index.js', 'index.mjs'].map((f) => join(full, f)).find((f) => existsSync(f));
        if (index) out.push(index);
      } else if (/\.m?js$/.test(name)) {
        out.push(full);
      }
    }
  }
  return out;
}

/** Theme files in a folder: every `.css` (not starting with _ or .). */
export function findThemes(dirs) {
  const out = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) if (/\.css$/i.test(name) && !/^[_.]/.test(name)) out.push(join(dir, name));
  }
  return out;
}

/**
 * Icons in a folder: every `.svg` (not starting with _ or .), registered under its file name, so
 * `icons/brand.svg` becomes `icon: 'brand'`. The markup is inlined into the payload; `width` and
 * `height` are dropped because CSS sizes icons, and it is sanitized when drawn.
 */
export function findIcons(dirs) {
  const out = {};
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (!/\.svg$/i.test(name) || /^[_.]/.test(name)) continue;
      const markup = readFileSync(join(dir, name), 'utf8').trim();
      if (!markup.includes('<svg')) throw new Error(`Icon ${join(dir, name)} is not an SVG`);
      out[basename(name, extname(name))] = markup
        .replace(/<svg\b[\s\S]*?>/, (open) => open.replace(/\s+(width|height)="[^"]*"/g, ''))
        .replace(/>\s+</g, '><');
    }
  }
  return out;
}

/** The part of the config the running client app gets (plain data, no build paths). */
export function runtimeConfig(config, { icons } = {}) {
  const { dirs: _pd, ...plugins } = config.plugins;
  const { dirs: _td, css: _css, ...themes } = config.themes;
  const { dirs: _id, set, ...iconOptions } = config.icons ?? {};
  return {
    origins: config.origins,
    settings: config.settings,
    runtime: config.runtime,
    plugins,
    themes,
    // Folder icons first, so an inline `icons.set` entry wins on a name clash.
    icons: { ...iconOptions, set: { ...icons, ...set } },
    pages: config.pages,
    about: config.about,
    welcome: config.welcome,
    whatsNew: config.whatsNew,
    badges: config.badges,
    api: config.api,
    host: config.host,
    desktop: config.desktop,
  };
}

function dataURI(file, { maxBytes = 5_000_000 } = {}) {
  if (typeof file !== 'string' || /^(https?:|data:)/.test(file)) return file;
  if (!existsSync(file)) throw new Error(`Installer asset not found: ${file}`);
  const data = readFileSync(file);
  if (data.length > maxBytes) throw new Error(`Installer asset ${file} is over ${Math.round(maxBytes / 1e6)} MB`);
  const mime = MIME[extname(file).toLowerCase()];
  if (!mime) throw new Error(`Installer asset ${file}: use png, jpg, gif, webp, svg or ico`);
  return `data:${mime};base64,${data.toString('base64')}`;
}

/** The installer's settings, with every local image inlined so the installer is self-contained. */
export function installerConfig(config, manifest) {
  const m = { ...config.installer.marketing };
  for (const key of ['logo', 'background', 'icon']) if (m[key] && !/^(#|linear-gradient|radial-gradient)/.test(m[key])) m[key] = dataURI(m[key]);
  if (m.css && existsSync(m.css)) m.css = readFileSync(m.css, 'utf8');
  if (Array.isArray(m.screenshots)) m.screenshots = m.screenshots.map((s) => ({ ...s, src: dataURI(s.src) }));
  if (Array.isArray(m.features)) m.features = m.features.map((f) => ({ ...f, icon: f.icon && /^[A-Za-z]:|^[/.]/.test(f.icon) ? dataURI(f.icon) : f.icon }));
  if (m.terms?.file) m.terms = { ...m.terms, text: readFileSync(m.terms.file, 'utf8'), file: undefined };
  if (!m.logo && config.icon) m.logo = dataURI(config.icon);
  return {
    preset: config.installer.preset,
    marketing: m,
    target: config.installer.target,
    closeApp: config.installer.closeApp,
    launchAfter: config.installer.launchAfter,
    gui: config.installer.gui,
    app: { id: manifest.id, name: manifest.name, version: manifest.version, description: manifest.description, authors: manifest.authors, links: manifest.links },
  };
}

/** The macOS and Linux launcher: runs the installer with the desktop app's own Node, or node. */
function launcherScript() {
  return `#!/bin/sh
# Runs the installer with the desktop app's own Node, or with node if it's installed.
HERE="$(cd "$(dirname "$0")" && pwd)"
for APP in "/Applications/Yapper.app/Contents/MacOS/Yapper" "$HOME/Applications/Yapper.app/Contents/MacOS/Yapper" "/opt/Yapper/yapper-desktop" "/opt/yapper-desktop/yapper-desktop" "/usr/lib/yapper-desktop/yapper-desktop"; do
  if [ -x "$APP" ]; then
    ELECTRON_RUN_AS_NODE=1 exec "$APP" "$HERE/installer.mjs" "$@"
  fi
done
if command -v node >/dev/null 2>&1; then
  exec node "$HERE/installer.mjs" "$@"
fi
echo "Couldn't find the Yapin' desktop app. Install it from https://www.yapin.gg first."
exit 1
`;
}

/**
 * The Windows installer: one .exe with the installer folder inside. With NSIS available it's a setup
 * wizard (see nsis.js). Otherwise it's the small launcher that opens the installer page in the browser,
 * compiled for this client app on Windows (its name, version and icon), or the prebuilt generic one.
 */
function buildSetupExe(config, { settings, installerDir, outDir }) {
  const windows = config.installer.windows ?? {};
  const file = join(outDir, windows.fileName ?? `${config.id}-${config.version}-setup.exe`);
  const icon = windows.icon ?? config.icon ?? null;
  const exeIcon = icon && /\.(png|ico)$/i.test(icon) ? icon : null;
  const company = windows.company ?? config.authors?.map((a) => a.name).join(', ') ?? '';
  const target = deepMerge(structuredClone(defaultTarget), config.installer.target ?? {});
  const exeName = target.executable?.win32 ?? 'Yapper.exe';
  const exe = (target.locations?.win32 ?? []).map((location) => `${location.replace(/[\\/]+$/, '')}\\${exeName}`);

  const makensis = windows.nsis === false ? null : findMakensis({ configured: windows.nsis });
  if (makensis) {
    buildNsisExe({ makensis, installer: settings, source: installerDir, out: file, icon: exeIcon, sidebar: windows.sidebar, header: windows.header, company, description: config.description, exeLocations: exe });
    if (windows.sign) signFile(windows.sign, file);
    return { file, kind: 'nsis', warning: null };
  }

  const warnings = [];
  if (typeof windows.nsis === 'string') warnings.push(`installer.windows.nsis: ${windows.nsis} didn't run, so the Windows .exe opens the installer in the browser instead of the setup wizard.`);
  else if (windows.nsis !== false) warnings.push("NSIS isn't installed, so the Windows .exe opens the installer in the browser instead of the setup wizard. Install NSIS (https://nsis.sourceforge.io, apt install nsis, or brew install makensis) for the wizard.");
  let launcher = PREBUILT_LAUNCHER;
  const work = mkdtempSync(join(tmpdir(), 'yc-setup-'));
  try {
    if (findCsc()) {
      launcher = compileLauncher({ out: join(work, 'launcher.exe'), name: config.name, version: config.version, description: config.description, company, icon: exeIcon });
    } else {
      warnings.push('Built the Windows .exe with the generic launcher (no csc.exe here), so it has no custom icon or file details. Build on Windows for those.');
    }
    createSetupExe({
      launcher,
      installerDir,
      out: file,
      meta: { id: config.id, name: config.name, version: config.version, exe: exe.join('|') },
      skip: (rel) => /\.(sh|command)$/.test(rel),
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (windows.sign) signFile(windows.sign, file);
  return { file, kind: 'launcher', warning: warnings.join(' ') || null };
}

function userscript(config, manifest, runtime) {
  const web = config.web;
  const matches = web.matches ?? config.origins.map((o) => `${o}/*`);
  const header = [
    '// ==UserScript==',
    `// @name         ${manifest.name}`,
    `// @namespace    ${web.namespace ?? config.links.source ?? config.links.website ?? `yapin-client/${manifest.id}`}`,
    `// @version      ${manifest.version}`,
    manifest.description && `// @description  ${manifest.description.replace(/\n/g, ' ')}`,
    manifest.authors?.length && `// @author       ${manifest.authors.map((a) => a.name).join(', ')}`,
    ...matches.map((m) => `// @match        ${m}`),
    '// @run-at       document-start',
    '// @grant        none',
    web.updateURL && `// @updateURL    ${web.updateURL}`,
    web.downloadURL && `// @downloadURL  ${web.downloadURL}`,
    '// ==/UserScript==',
  ].filter(Boolean);
  const args = { manifest, safeMode: false, environment: { userscript: true } };
  return `${header.join('\n')}\n\n(${runtime})().default(${JSON.stringify(args)});\n`;
}

/** Empties the output folder, but only one an earlier build made, and never the project or a parent of it. */
function prepareOutDir(dir, root) {
  const projectInside = relative(dir, root);
  if (projectInside === '' || (!projectInside.startsWith('..') && !isAbsolute(projectInside))) throw new Error(`outDir (${dir}) can't be the project folder or contain it`);
  if (existsSync(dir)) {
    const entries = readdirSync(dir);
    if (entries.length && !entries.includes(BUILD_MARKER)) {
      throw new Error(`${dir} has files that weren't made by a build; refusing to delete them. Pick another outDir or empty it.`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, BUILD_MARKER), 'Made by yapin.js-client build. This whole folder is deleted on the next build.\n');
}

/**
 * Builds a client app into `config.outDir`:
 *   payload/            what gets installed: manifest.json, runtime.js, preload.cjs, shim.cjs
 *   installer/<id>/     the branded installer: launchers, installer.mjs, installer.json, payload/
 *   <id>-<version>-setup.exe  the Windows installer (one file)
 *   <id>-<version>-installer.zip  the same for macOS and Linux (and anyone who prefers a folder)
 *   <id>.user.js        the web version, for userscript managers
 */
export async function build(config, { root, mode = 'production', onStep = () => {}, installer = true } = {}) {
  const started = Date.now();
  const warnings = [];
  const outDir = config.outDir;
  prepareOutDir(outDir, root);

  onStep('Collecting plugins and themes');
  const pluginFiles = findPlugins(config.plugins.dirs);
  const themeFiles = findThemes(config.themes.dirs);
  const iconFiles = findIcons(config.icons?.dirs ?? []);
  const baseCSS = config.themes.css ? readFileSync(config.themes.css, 'utf8') : '';

  const imports = [`import { boot } from ${JSON.stringify(toPosix(join(SRC, 'runtime', 'boot.js')))};`];
  imports.push(config.entry ? `import * as entry from ${JSON.stringify(toPosix(config.entry))};` : 'const entry = null;');
  pluginFiles.forEach((file, i) => imports.push(`import plugin${i} from ${JSON.stringify(toPosix(file))};`));
  themeFiles.forEach((file, i) => imports.push(`import theme${i} from ${JSON.stringify(toPosix(file))};`));
  const virtualEntry = `${imports.join('\n')}
const plugins = [${pluginFiles.map((_, i) => `plugin${i}`).join(', ')}];
const themes = [${themeFiles.map((file, i) => `{ file: ${JSON.stringify(basename(file))}, text: theme${i} }`).join(', ')}];
export default (args) => boot(args, { entry, plugins, themes });
`;

  onStep('Bundling the runtime');
  const bundled = pack({
    entry: 'yapin-client:entry',
    root,
    virtual: { 'yapin-client:entry': { code: virtualEntry, dir: root } },
    alias: { 'yapin.js-client/runtime': join(SRC, 'runtime', 'index.js') },
    urlPrefix: `yapin-client://${config.id}/`,
  });
  const runtime = bundled.code;

  const git = config.git === false ? null : readGitInfo(root);
  if (config.git !== false && !git) warnings.push('Not a git repository (or git is not installed); the About page will have no source info');

  const manifest = {
    id: config.id,
    name: config.name,
    version: config.version,
    description: config.description ?? '',
    authors: config.authors,
    links: config.links,
    framework: frameworkVersion,
    apiVersion,
    build: { time: new Date().toISOString(), mode },
    git,
    baseCSS,
    config: runtimeConfig(config, { icons: iconFiles }),
    files: {},
  };
  if (mode === 'development') {
    manifest.config.runtime = { ...manifest.config.runtime, exposeGlobal: manifest.config.runtime.exposeGlobal ?? camel(config.id), logLevel: manifest.config.runtime.logLevel ?? 'debug' };
  }

  onStep('Writing the payload');
  const payloadDir = join(outDir, 'payload');
  mkdirSync(payloadDir, { recursive: true });
  const files = {
    'runtime.js': runtime,
    'preload.cjs': readFileSync(join(SRC, 'desktop', 'preload.cjs'), 'utf8'),
    'shim.cjs': readFileSync(join(SRC, 'desktop', 'shim.cjs'), 'utf8'),
  };
  for (const [name, text] of Object.entries(files)) {
    writeFileSync(join(payloadDir, name), text);
    manifest.files[name] = sha256(text);
  }
  writeFileSync(join(payloadDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (config.icon && existsSync(config.icon)) {
    mkdirSync(join(payloadDir, 'assets'), { recursive: true });
    copyFileSync(config.icon, join(payloadDir, 'assets', `icon${extname(config.icon)}`));
  }

  let userscriptFile = null;
  if (config.web.userscript !== false) {
    onStep('Writing the userscript');
    userscriptFile = join(outDir, `${config.id}.user.js`);
    writeFileSync(userscriptFile, userscript(config, manifest, runtime));
  }

  let installerDir = null;
  let zipFile = null;
  let exeFile = null;
  let exeKind = null;
  if (installer) {
    onStep('Building the installer');
    installerDir = join(outDir, 'installer', config.id);
    mkdirSync(installerDir, { recursive: true });
    const installerBundle = pack({ entry: join(SRC, 'installer', 'main.js'), format: 'module', root: SRC });
    writeFileSync(join(installerDir, 'installer.mjs'), installerBundle.code);
    const settings = installerConfig(config, manifest);
    writeFileSync(join(installerDir, 'installer.json'), JSON.stringify(settings, null, 2));
    cpSync(payloadDir, join(installerDir, 'payload'), { recursive: true });
    const sh = launcherScript();
    const safeName = config.name.replace(/[^\w .-]+/g, '').trim() || config.id;
    writeFileSync(join(installerDir, 'install.sh'), sh);
    writeFileSync(join(installerDir, `Install ${safeName}.command`), sh);
    for (const file of ['install.sh', `Install ${safeName}.command`]) {
      try {
        chmodSync(join(installerDir, file), 0o755);
      } catch {
        // Windows has no exec bit; the zip carries it instead
      }
    }
    writeFileSync(
      join(installerDir, 'README.txt'),
      `${config.name} ${config.version}\r\n\r\nWindows: run ${config.id}-${config.version}-setup.exe instead of this folder.\r\nmacOS: double-click "Install ${safeName}.command".\r\nLinux: run ./install.sh\r\nAnywhere with Node: node installer.mjs (add --cli for the terminal version).\r\n\r\nOn macOS and Linux the installer opens in your browser. Close the Yapin' desktop app first, or the installer will offer to.\r\nTo remove ${config.name}, run the installer again and choose Uninstall.\r\n`,
    );
    if (config.installer.zip !== false) {
      zipFile = join(outDir, `${config.id}-${config.version}-installer.zip`);
      zipDirectory(installerDir, zipFile, { prefix: `${config.id}-installer` });
    }
    const windows = config.installer.windows ?? {};
    if (windows.exe !== false && config.installer.gui !== false) {
      onStep('Building the Windows setup .exe');
      const built = buildSetupExe(config, { settings, installerDir, outDir });
      exeFile = built.file;
      exeKind = built.kind;
      if (built.warning) warnings.push(built.warning);
    }
  }

  writeFileSync(join(outDir, 'build.json'), JSON.stringify({ id: config.id, version: config.version, mode, time: manifest.build.time, plugins: pluginFiles.map((f) => toPosix(relative(root, f))), themes: themeFiles.map((f) => toPosix(relative(root, f))), runtimeBytes: runtime.length, hash: bundled.hash }, null, 2));
  return { outDir, payloadDir, installerDir, zipFile, exeFile, exeKind, userscriptFile, manifest, plugins: pluginFiles, themes: themeFiles, files: bundled.files, warnings, ms: Date.now() - started };
}

function camel(id) {
  return id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase()).replace(/^[0-9]/, '_$&');
}
