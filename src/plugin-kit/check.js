import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { pack } from '../build/pack.js';
import { parseMeta, readSignature } from '../runtime/meta.js';
import { normalizeSchema } from '../runtime/settings.js';
import { RUNTIME_SHIM, SHIM_EXPORTS } from './build.js';
import { headerTags } from './header.js';
import { apiVersion as currentApiVersion, idPattern } from '../shared/constants.js';

const VERSION = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const PLATFORMS = ['win32', 'darwin', 'linux', 'web'];
const RUNTIME_SPEC = 'yapin.js-client/runtime';

/** `import { a, b as c } from 'yapin.js-client/runtime'` → ['a', 'b']. */
function runtimeImports(source) {
  const names = [];
  const re = new RegExp(String.raw`import\s+([^'"]*?)\s+from\s*['"]${RUNTIME_SPEC.replace('.', '\\.')}['"]`, 'g');
  let match;
  while ((match = re.exec(source))) {
    const clause = match[1];
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].trim();
        if (name) names.push(name);
      }
    }
    const bare = clause.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
    if (bare && !bare.startsWith('*')) names.push('default');
    if (bare.startsWith('*')) names.push('*');
  }
  return names;
}

function checkHeader(meta, { problems, warnings, file, standalone, theme }) {
  // A file people download must say what it is in its header, because that's all the client can show
  // them before it runs. A plugin built into a client app can put the same things in its definition
  // instead, so there the header is only a nicety.
  const missing = standalone ? problems : warnings;
  const note = standalone ? '' : ' (or in the definition, for a plugin built into a client app)';
  if (!meta.id) warnings.push(`no @id in the header; the file name ("${basename(file)}") will be used instead`);
  else if (!idPattern.test(meta.id)) problems.push(`@id "${meta.id}" must be 1 to 64 lowercase letters, digits and dashes`);
  if (!meta.name) missing.push(`no @name${note}`);
  if (!meta.version) missing.push(`no @version${note}`);
  else if (!VERSION.test(meta.version)) warnings.push(`@version "${meta.version}" doesn't look like 1.2.3, so update checks can't compare it`);
  if (!meta.authors?.length) missing.push(`no @author${note}`);
  if (meta.apiVersion !== undefined) {
    if (!Number.isFinite(meta.apiVersion)) problems.push('@apiVersion must be a number');
    else if (meta.apiVersion > currentApiVersion) problems.push(`@apiVersion ${meta.apiVersion} is newer than this framework's (${currentApiVersion})`);
  } else if (standalone && !theme) {
    // Themes have no plugin API to be compatible with.
    warnings.push(`no @apiVersion; add "@apiVersion ${currentApiVersion}" so clients can tell whether they can run this`);
  }
  if (meta.minClientVersion !== undefined && !VERSION.test(String(meta.minClientVersion))) {
    problems.push(`@minClientVersion "${meta.minClientVersion}" must look like 1.2.3`);
  }
  for (const platform of meta.platforms ?? []) {
    if (!PLATFORMS.includes(platform)) problems.push(`@platforms "${platform}" isn't one of ${PLATFORMS.join(', ')}`);
  }
  for (const [field, value] of [['website', meta.website], ['updateUrl', meta.updateUrl]]) {
    if (value !== undefined && !/^https:\/\//.test(value)) problems.push(`@${field} must be an https link`);
  }
}

function checkPluginCode(text, file, { problems, warnings }) {
  if (!/export\s+default|export\s*\{[^}]*\bas\s+default\b/.test(text)) {
    problems.push('no default export; a plugin file must `export default { id, name, start() {} }`');
  }
  const unknown = [...new Set(runtimeImports(text))].filter((name) => name !== '*' && !SHIM_EXPORTS.includes(name));
  if (unknown.length) {
    problems.push(`a plugin file can't import ${unknown.map((n) => `"${n}"`).join(', ')} from "${RUNTIME_SPEC}"; a user plugin only gets ${SHIM_EXPORTS.join(', ')} — everything else is on ctx (ctx.h, ctx.ui, ctx.api, ctx.modules, ctx.patch)`);
  }
  if (runtimeImports(text).includes('*')) {
    warnings.push(`importing all of "${RUNTIME_SPEC}" only gives you ${SHIM_EXPORTS.join(', ')} in a user plugin; use ctx for the rest`);
  }
  if (/\bimport\s*\(\s*['"`]https?:/.test(text)) {
    warnings.push("this loads code from a URL at runtime (`import('https://…')`), which a signature can't cover: whoever reviews or verifies this plugin is not vouching for whatever that URL serves later");
  }
  const signature = readSignature(text);
  if (/@signature\b/.test(text) && !signature) problems.push('the @signature line is malformed; it must read "@signature <algorithm> <keyId> <base64>"');
  // Packed from the text we were given, through a virtual entry, so this checks what the caller holds
  // rather than whatever happens to be on disk — `plugin check` runs before anything is written.
  const dir = dirname(resolve(file));
  try {
    pack({
      entry: resolve(file),
      root: dir,
      virtual: { [resolve(file)]: { code: text, dir }, [RUNTIME_SPEC]: { code: RUNTIME_SHIM, dir } },
    });
  } catch (error) {
    problems.push(error.message);
  }
}

function checkTheme(text, file, vars, { problems }) {
  try {
    const schema = Object.fromEntries(
      vars.map((v) => [
        v.variable.replace(/^--/, ''),
        { ...v, type: ['color', 'number', 'slider', 'select', 'switch'].includes(v.type) ? v.type : 'text', options: v.options ?? (v.type === 'select' ? [v.default] : undefined) },
      ]),
    );
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
}

/**
 * Checks one plugin (`.js`) or theme (`.css`) file the way a client will read it: the header first
 * (because that is all a person sees before deciding to install), then the code.
 *
 * `standalone` means the file is one people download and install on its own, so its header has to be
 * complete. It defaults to the naming convention the client uses for installed files
 * (`*.plugin.js`, `*.theme.css`); anything else is treated as a plugin built into a client app, where
 * the metadata may live in the definition instead.
 *
 * Returns { problems, warnings, meta, vars, signature }.
 */
export function checkFile(file, text = readFileSync(resolve(file), 'utf8'), { standalone = /\.(plugin\.js|theme\.css)$/i.test(file) } = {}) {
  const problems = [];
  const warnings = [];
  const theme = /\.css$/i.test(file);
  const { meta, vars } = parseMeta(text);
  const report = { problems, warnings, file, standalone, theme };
  checkHeader(meta, report);
  if (theme) checkTheme(text, file, vars, report);
  else checkPluginCode(text, file, report);
  return { problems, warnings, meta, vars, signature: readSignature(text) };
}

/**
 * Checks a built plugin against the manifest it was built from, so a hand-edited `dist/` file or a
 * stale build can't be published as if it matched the source.
 */
export function checkAgainstManifest(manifest, text) {
  const problems = [];
  const { meta } = parseMeta(text);
  const expected = new Map(headerTags(manifest).map(([tag, value]) => [tag, String(value)]));
  for (const [tag, value] of [['id', meta.id], ['name', meta.name], ['version', meta.version]]) {
    if (expected.has(tag) && String(value ?? '') !== expected.get(tag)) {
      problems.push(`the built file says @${tag} "${value ?? ''}" but the manifest says "${expected.get(tag)}"; rebuild it`);
    }
  }
  return problems;
}

/** True when `file` exists and looks like something this can check. */
export function checkable(file) {
  return existsSync(file) && ['.js', '.mjs', '.css'].includes(extname(file).toLowerCase());
}
