import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parseAuthor } from '../runtime/meta.js';
import { apiVersion as currentApiVersion, idPattern } from '../shared/constants.js';

/**
 * A standalone plugin project's manifest. Plugin authors edit this; `yapin-client plugin build`
 * compiles it into the metadata header of the single `.plugin.js` file people install, so the header
 * and the manifest can never drift apart.
 *
 * The header stays the wire format because it is read *before* the plugin's code runs — that's what
 * lets the client describe a plugin it hasn't executed.
 */
export const MANIFEST_FILE = 'yapin-plugin.json';

const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const PLATFORMS = ['win32', 'darwin', 'linux', 'web'];

/** Fields the manifest may set, and whether they reach the generated header. */
const FIELDS = new Set([
  'id', 'name', 'description', 'version', 'authors', 'license', 'website', 'apiVersion',
  'minClientVersion', 'platforms', 'tags', 'dependencies', 'conflicts', 'updateUrl',
  'entry', 'outDir', 'client',
]);

export class ManifestError extends Error {
  constructor(problems, file) {
    super(`${file ? `${file}: ` : ''}${problems.length === 1 ? problems[0] : `\n  - ${problems.join('\n  - ')}`}`);
    this.name = 'ManifestError';
    this.problems = problems;
  }
}

/** For editor types in a manifest built by code. Returns it unchanged. */
export function definePluginManifest(manifest) {
  return manifest;
}

function isHttps(url) {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

function list(value) {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).filter((v) => v !== null && v !== undefined && v !== '');
}

/**
 * Checks a manifest and fills in what's derived. Returns { manifest, warnings }; throws a
 * ManifestError listing every problem at once, the way the client app config does.
 */
export function validateManifest(input, { root = process.cwd(), file = null } = {}) {
  const problems = [];
  const warnings = [];
  for (const key of Object.keys(input)) if (!FIELDS.has(key)) warnings.push(`Unknown field "${key}"`);

  const manifest = { ...input };
  if (!manifest.id || !idPattern.test(manifest.id)) problems.push(`id "${manifest.id ?? ''}" must be 1 to 64 lowercase letters, digits and dashes`);
  if (!manifest.name || typeof manifest.name !== 'string') problems.push('name is required (shown wherever the plugin is listed)');
  if (!VERSION.test(String(manifest.version ?? ''))) problems.push(`version "${manifest.version ?? ''}" must look like 1.2.3`);
  if (!manifest.description) warnings.push('no description; people see it before they install');

  // A string author may carry its link, the way the header writes it: "Ada <https://ada.dev>".
  manifest.authors = list(manifest.authors).map((a) => (typeof a === 'string' ? parseAuthor(a) : a)).filter((a) => a?.name);
  if (!manifest.authors.length) problems.push('authors is required (people see who wrote a plugin before installing it)');
  for (const author of manifest.authors) {
    if (author.url && !isHttps(author.url)) problems.push(`authors: ${author.name}'s url must be https`);
  }

  manifest.apiVersion = Number(manifest.apiVersion ?? currentApiVersion);
  if (!Number.isInteger(manifest.apiVersion) || manifest.apiVersion < 1) problems.push('apiVersion must be a whole number (1 or more)');
  else if (manifest.apiVersion > currentApiVersion) problems.push(`apiVersion ${manifest.apiVersion} is newer than this framework's (${currentApiVersion})`);

  if (manifest.minClientVersion !== undefined && !VERSION.test(String(manifest.minClientVersion))) {
    problems.push(`minClientVersion "${manifest.minClientVersion}" must look like 1.2.3`);
  }

  manifest.platforms = list(manifest.platforms);
  for (const platform of manifest.platforms) {
    if (!PLATFORMS.includes(platform)) problems.push(`platforms: "${platform}" isn't one of ${PLATFORMS.join(', ')}`);
  }

  manifest.tags = list(manifest.tags).map(String);
  manifest.dependencies = list(manifest.dependencies).map(String);
  manifest.conflicts = list(manifest.conflicts).map(String);
  for (const [field, ids] of [['dependencies', manifest.dependencies], ['conflicts', manifest.conflicts]]) {
    for (const id of ids) if (!idPattern.test(id)) problems.push(`${field}: "${id}" isn't a valid plugin id`);
  }
  if (manifest.dependencies.includes(manifest.id)) problems.push("dependencies can't include the plugin itself");

  if (manifest.website !== undefined && !isHttps(manifest.website)) problems.push('website must be an https link');
  if (manifest.updateUrl !== undefined && !isHttps(manifest.updateUrl)) problems.push('updateUrl must be an https link to the built .plugin.js file');

  manifest.entry = resolve(root, manifest.entry ?? join('src', 'index.js'));
  if (!existsSync(manifest.entry)) problems.push(`entry ${manifest.entry} doesn't exist`);
  manifest.outDir = isAbsolute(manifest.outDir ?? '') ? manifest.outDir : resolve(root, manifest.outDir ?? 'dist');

  if (manifest.client !== undefined && !idPattern.test(manifest.client)) {
    problems.push(`client "${manifest.client}" must be the id of a client app (what \`plugin dev\` installs into)`);
  }

  if (problems.length) throw new ManifestError(problems, file);
  return { manifest, warnings };
}

/** Finds, reads and validates `yapin-plugin.json`. */
export function loadManifest({ cwd = process.cwd(), file: explicit } = {}) {
  const file = explicit ? resolve(cwd, explicit) : join(cwd, MANIFEST_FILE);
  if (!existsSync(file)) {
    throw Object.assign(new ManifestError([`No ${MANIFEST_FILE} here`], null), {
      hint: 'Run yapin-client plugin init to start a plugin project.',
    });
  }
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (cause) {
    throw new ManifestError([`isn't valid JSON: ${cause.message}`], file);
  }
  const root = dirname(file);
  const { manifest, warnings } = validateManifest(raw, { root, file });
  return { manifest, root, file, warnings };
}
