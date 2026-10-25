import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaults } from './defaults.js';
import { deepMerge, isPlainObject } from '../runtime/util.js';
import { idPattern } from '../shared/constants.js';

export const CONFIG_FILES = ['yapin-client.config.js', 'yapin-client.config.mjs', 'yapin-client.config.json'];

/** Sections that reach the running client app, so they must be JSON. */
const RUNTIME_SECTIONS = ['settings', 'runtime', 'plugins', 'themes', 'pages', 'about', 'badges', 'api', 'host', 'desktop', 'origins', 'links'];

export class ConfigError extends Error {
  constructor(problems, file) {
    super(`${file ? `${file}: ` : ''}${problems.length === 1 ? problems[0] : `\n  - ${problems.join('\n  - ')}`}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

/** For editor types in the config file: `export default defineConfig({ … })`. Returns it unchanged. */
export function defineConfig(config) {
  return config;
}

function findConfig(cwd, explicit) {
  if (explicit) {
    const file = resolve(cwd, explicit);
    if (!existsSync(file)) throw new ConfigError([`Config file not found: ${file}`]);
    return file;
  }
  for (const name of CONFIG_FILES) {
    const file = join(cwd, name);
    if (existsSync(file)) return file;
  }
  return null;
}

async function importConfig(file) {
  if (file.endsWith('.json')) return JSON.parse(readFileSync(file, 'utf8'));
  const mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
  const value = mod.default ?? mod.config;
  return typeof value === 'function' ? await value({ mode: process.env.YAPIN_CLIENT_MODE ?? 'production' }) : value;
}

function readPackage(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Finds paths that hold something JSON can't: functions, symbols, class instances, undefined in arrays. */
function nonJSON(value, path, out) {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) out.push(`${path} is ${value}, which isn't valid JSON`);
    return;
  }
  if (value === undefined) return;
  if (typeof value === 'function') {
    out.push(`${path} is a function; options that reach the client app must be plain data. Put code in your entry file instead`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => nonJSON(item, `${path}[${i}]`, out));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, inner] of Object.entries(value)) nonJSON(inner, `${path}.${key}`, out);
    return;
  }
  out.push(`${path} is a ${value?.constructor?.name ?? typeof value}; only plain objects, arrays, strings, numbers and booleans work here`);
}

function isHttps(url, { allowLocal = false } = {}) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || (allowLocal && parsed.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname));
  } catch {
    return false;
  }
}

function closest(word, options) {
  let best = null;
  let bestScore = Infinity;
  for (const option of options) {
    const a = word.toLowerCase();
    const b = option.toLowerCase();
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (dp[a.length][b.length] < bestScore) {
      bestScore = dp[a.length][b.length];
      best = option;
    }
  }
  return bestScore <= 2 ? best : null;
}

/**
 * Checks a merged config and fills in what's derived (allowed origins from services and badge sources).
 * Returns { config, warnings }; throws a ConfigError listing every problem at once.
 */
export function validateConfig(input, { root = process.cwd(), file = null } = {}) {
  const problems = [];
  const warnings = [];
  for (const key of Object.keys(input)) {
    if (!(key in defaults)) {
      const guess = closest(key, Object.keys(defaults));
      warnings.push(`Unknown option "${key}"${guess ? `; did you mean "${guess}"?` : ''}`);
    }
  }
  const config = deepMerge(structuredClone(defaults), input);
  if (!config.id || !idPattern.test(config.id)) problems.push(`id "${config.id ?? ''}" must be 1 to 64 lowercase letters, digits and dashes (it names folders and storage)`);
  if (!config.name || typeof config.name !== 'string') problems.push('name is required (shown in settings and the installer)');
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(String(config.version ?? ''))) problems.push(`version "${config.version ?? ''}" must look like 1.2.3`);
  for (const section of RUNTIME_SECTIONS) nonJSON(config[section], section, problems);
  if (!Array.isArray(config.origins) || !config.origins.every((o) => isHttps(o))) problems.push('origins must be a list of https origins');
  else config.origins = config.origins.map((o) => new URL(o).origin);
  for (const [key, url] of Object.entries(config.links ?? {})) {
    if (!isHttps(url) && !String(url).startsWith('mailto:')) problems.push(`links.${key} must be an https or mailto: link`);
  }
  config.authors = (Array.isArray(config.authors) ? config.authors : [config.authors]).filter(Boolean).map((a) => (typeof a === 'string' ? { name: a } : a));

  const allowed = new Set();
  for (const origin of config.api.allowedOrigins ?? []) {
    if (!isHttps(origin, { allowLocal: true })) problems.push(`api.allowedOrigins: "${origin}" must be an https origin`);
    else allowed.add(new URL(origin).origin);
  }
  for (const [name, service] of Object.entries(config.api.services ?? {})) {
    if (!isPlainObject(service) || !isHttps(service.baseURL, { allowLocal: true })) problems.push(`api.services.${name}.baseURL must be an https URL`);
    else allowed.add(new URL(service.baseURL).origin);
    if (service?.auth && typeof service.auth.secret !== 'string') problems.push(`api.services.${name}.auth.secret must name a secret (set it with client.secrets.set)`);
  }
  (config.badges.sources ?? []).forEach((source, i) => {
    if (!isPlainObject(source) || !idPattern.test(source.id ?? '')) problems.push(`badges.sources[${i}].id must be lowercase letters, digits and dashes`);
    if (!isHttps(source?.url, { allowLocal: true })) problems.push(`badges.sources[${i}].url must be an https URL`);
    else allowed.add(new URL(source.url).origin);
  });
  config.api.allowedOrigins = [...allowed];

  for (const kind of ['plugins', 'themes']) {
    config[kind].dirs = (config[kind].dirs ?? []).map((d) => (isAbsolute(d) ? d : resolve(root, d)));
  }
  if (config.entry) {
    config.entry = resolve(root, config.entry);
    if (!existsSync(config.entry)) problems.push(`entry ${config.entry} doesn't exist`);
  }
  if (config.themes.css) {
    config.themes.css = resolve(root, config.themes.css);
    if (!existsSync(config.themes.css)) problems.push(`themes.css ${config.themes.css} doesn't exist`);
  }
  if (config.icon) config.icon = resolve(root, config.icon);
  if (config.installer.windows?.icon) config.installer.windows.icon = resolve(root, config.installer.windows.icon);
  if (typeof config.installer.windows?.nsis === 'string') config.installer.windows.nsis = resolve(root, config.installer.windows.nsis);
  for (const [key, size] of [['sidebar', '164×314'], ['header', '150×57']]) {
    const file = config.installer.windows?.[key];
    if (!file) continue;
    config.installer.windows[key] = resolve(root, file);
    if (!/\.bmp$/i.test(file)) problems.push(`installer.windows.${key} must be a .bmp (${size} pixels)`);
    else if (!existsSync(config.installer.windows[key])) problems.push(`installer.windows.${key} ${config.installer.windows[key]} doesn't exist`);
  }
  if (config.installer.windows?.sign && (typeof config.installer.windows.sign !== 'string' || !config.installer.windows.sign.includes('{file}'))) problems.push('installer.windows.sign must be a command containing {file}, like: signtool sign /fd sha256 /a {file}');
  if (!['leave', 'relax'].includes(config.desktop.csp)) problems.push('desktop.csp must be "leave" or "relax"');
  if (!['default', 'minimal', 'showcase'].includes(config.installer.preset)) problems.push('installer.preset must be "default", "minimal" or "showcase"');
  if (!['ask', 'always', 'never'].includes(config.installer.closeApp)) problems.push('installer.closeApp must be "ask", "always" or "never"');
  if (config.pages.position && !/^(start|end|(before|after):.+)$/i.test(config.pages.position)) problems.push('pages.position must be "start", "end", "before:<label>" or "after:<label>"');
  if (problems.length) throw new ConfigError(problems, file);
  config.outDir = resolve(root, config.outDir);
  return { config, warnings };
}

/** Reads the marketing file if `installer.marketing` is a path, and resolves asset paths in it. */
function loadMarketing(config, root) {
  let marketing = config.installer.marketing;
  let base = root;
  if (typeof marketing === 'string') {
    const file = resolve(root, marketing);
    if (!existsSync(file)) throw new ConfigError([`installer.marketing file not found: ${file}`]);
    marketing = JSON.parse(readFileSync(file, 'utf8'));
    base = dirname(file);
  }
  marketing = { ...marketing };
  const asset = (p) => (typeof p === 'string' && !/^(https?:|data:)/.test(p) ? resolve(base, p) : p);
  for (const key of ['logo', 'background', 'css', 'icon']) if (marketing[key]) marketing[key] = asset(marketing[key]);
  if (Array.isArray(marketing.screenshots)) marketing.screenshots = marketing.screenshots.map((s) => (typeof s === 'string' ? { src: asset(s) } : { ...s, src: asset(s.src) }));
  if (Array.isArray(marketing.features)) marketing.features = marketing.features.map((f) => ({ ...f, icon: f.icon && /[\\/.]/.test(f.icon) && !/^\p{Extended_Pictographic}/u.test(f.icon) ? asset(f.icon) : f.icon }));
  if (marketing.terms?.file) marketing.terms = { ...marketing.terms, file: asset(marketing.terms.file) };
  config.installer.marketing = marketing;
}

/**
 * Finds, loads and validates the config. `id`, `name`, `version`, `description` and `authors` default
 * to package.json's.
 */
export async function loadConfig({ cwd = process.cwd(), file: explicit, overrides = {} } = {}) {
  const file = findConfig(cwd, explicit);
  const root = file ? dirname(file) : cwd;
  const raw = file ? await importConfig(file) : {};
  if (!isPlainObject(raw)) throw new ConfigError(['The config must export an object (export default defineConfig({ … }))'], file);
  const pkg = readPackage(root);
  const fromPackage = pkg
    ? {
        id: pkg.name?.replace(/^@[^/]+\//, '').toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
        name: pkg.displayName ?? pkg.name,
        version: pkg.version,
        description: pkg.description,
        authors: pkg.author ? [typeof pkg.author === 'string' ? { name: pkg.author.replace(/\s*[<(].*$/, '') } : pkg.author] : undefined,
      }
    : {};
  const merged = deepMerge(Object.fromEntries(Object.entries(fromPackage).filter(([, v]) => v !== undefined)), deepMerge(raw, overrides));
  const { config, warnings } = validateConfig(merged, { root, file });
  loadMarketing(config, root);
  return { config, root, file, warnings, packageJson: pkg };
}
