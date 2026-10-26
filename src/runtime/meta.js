/**
 * Reads the metadata comment at the top of a theme (.css) or plugin (.js) file:
 *
 *   /**
 *    * @id midnight
 *    * @name Midnight
 *    * @version 1.2.0
 *    * @author Ada <https://example.com>
 *    * @var --accent color #7c5cff Accent colour
 *    * @var --radius number 8 Corner radius | min=0 max=24 unit=px
 *    *\/
 *
 * Unknown tags are kept in `meta.extra`. Tags that may repeat (@author, @var, @tag) become lists.
 */
const LIST_TAGS = new Set(['author', 'var', 'tag', 'tags', 'dependency', 'dependencies', 'conflicts', 'platform', 'platforms']);
const KNOWN = new Set(['id', 'name', 'description', 'version', 'author', 'authors', 'license', 'source', 'website', 'donate', 'support', 'apiVersion', 'minClientVersion', 'platform', 'platforms', 'tag', 'tags', 'var', 'dependency', 'dependencies', 'conflicts', 'mode', 'preview', 'updateUrl']);

/**
 * `@signature` is deliberately NOT in KNOWN: it must not reach a plugin definition, because trust is
 * something the client decides, never something a plugin file says about itself. Read it with
 * `readSignature` instead. For the same reason there is no `@integrity` tag — a file can't contain its
 * own hash; that belongs in the registry entry that points at the file.
 */
const SIGNATURE_LINE = /^[^\S\n]*\*?[^\S\n]*@signature\b[^\n]*\n?/m;

export function readHeader(source) {
  const match = /^\s*\/\*\*?([\s\S]*?)\*\//.exec(String(source ?? ''));
  if (!match) return null;
  const tags = {};
  let current = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*\*?\s?/, '');
    const tag = /^@([A-Za-z][\w-]*)\s*(.*)$/.exec(line);
    if (tag) {
      current = { name: tag[1], value: tag[2].trim() };
      (tags[current.name] ??= []).push(current);
    } else if (current && line.trim()) {
      current.value += `\n${line.trim()}`;
    }
  }
  return tags;
}

export function parseAuthor(text) {
  const match = /^(.*?)\s*(?:<([^>]+)>|\(([^)]+)\))?\s*$/.exec(text.trim());
  const name = match?.[1]?.trim() || text.trim();
  const url = (match?.[2] ?? match?.[3] ?? '').trim();
  return url ? { name, url } : { name };
}

/** Splits on spaces, keeping "quoted text" together. */
function words(text) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
  let m;
  while ((m = re.exec(text))) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]);
  return out;
}

function parseValue(type, raw) {
  if (raw === undefined) return undefined;
  if (type === 'number' || type === 'slider') return Number(raw);
  if (type === 'switch') return raw === 'true' || raw === 'on' || raw === 'yes';
  return raw;
}

/** `@var --name type default Label words | key=value key=value` → a theme variable definition. */
export function parseVar(text) {
  const [main, extra = ''] = text.split(/\s\|\s/, 2);
  const [variable, type = 'text', rawDefault, ...label] = words(main);
  if (!variable?.startsWith('--')) return null;
  const def = { variable, type, default: parseValue(type, rawDefault), label: label.join(' ') || variable };
  for (const pair of words(extra)) {
    const [key, ...rest] = pair.split('=');
    const value = rest.join('=');
    if (!key) continue;
    if (key === 'options') def.options = value.split(',').map((v) => v.trim()).filter(Boolean);
    else if (['min', 'max', 'step'].includes(key)) def[key] = Number(value);
    else def[key] = value;
  }
  return def;
}

/** The header as a definition object: { id, name, version, authors, vars, … }. */
export function parseMeta(source) {
  const tags = readHeader(source);
  if (!tags) return { meta: {}, vars: [] };
  const meta = { extra: {} };
  const vars = [];
  for (const [name, entries] of Object.entries(tags)) {
    const values = entries.map((e) => e.value);
    if (name === 'var') {
      for (const v of values) {
        const parsed = parseVar(v);
        if (parsed) vars.push(parsed);
      }
    } else if (name === 'author' || name === 'authors') {
      meta.authors = [...(meta.authors ?? []), ...values.flatMap((v) => v.split(/\s*,\s*(?![^<(]*[>)])/)).filter(Boolean).map(parseAuthor)];
    } else if (name === 'tag' || name === 'tags') {
      meta.tags = [...(meta.tags ?? []), ...values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)];
    } else if (name === 'dependency' || name === 'dependencies') {
      meta.dependencies = [...(meta.dependencies ?? []), ...values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)];
    } else if (name === 'conflicts') {
      meta.conflicts = values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
    } else if (name === 'platform' || name === 'platforms') {
      meta.platforms = [...(meta.platforms ?? []), ...values.flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean)];
    } else if (name === 'apiVersion') {
      meta.apiVersion = Number(values[0]);
    } else if (KNOWN.has(name)) {
      meta[name] = LIST_TAGS.has(name) ? values : values[values.length - 1];
    } else {
      meta.extra[name] = values.length === 1 ? values[0] : values;
    }
  }
  return { meta, vars };
}

/**
 * The exact bytes a plugin signature covers. **Frozen**: line endings normalised to `\n`, the
 * `@signature` line removed from the metadata header, encoded UTF-8. Changing any part of this
 * invalidates every signature ever issued, so it must not change. docs/plugin-development.md
 * describes the format.
 */
export function canonicalText(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  const header = /^\s*\/\*\*?[\s\S]*?\*\//.exec(text);
  if (!header) return text;
  return text.slice(0, header.index) + header[0].replace(SIGNATURE_LINE, '') + text.slice(header.index + header[0].length);
}

/**
 * The `@signature <algorithm> <keyId> <base64>` line, if there is one, with the bytes it covers.
 * Returns null when the file is unsigned or the line is malformed — never throws, because this runs on
 * files from strangers.
 */
export function readSignature(source) {
  const entries = readHeader(source)?.signature;
  const raw = entries?.[entries.length - 1]?.value;
  if (!raw) return null;
  const [algorithm, keyId, value, ...rest] = String(raw).trim().split(/\s+/);
  if (!algorithm || !keyId || !value || rest.length) return null;
  return { algorithm, keyId, value, canonical: canonicalText(source) };
}

/** A file name turned into an id: "Midnight Theme.theme.css" → "midnight-theme". */
export function idFromFile(file) {
  return String(file)
    .replace(/^.*[\\/]/, '')
    .replace(/(\.(theme|plugin|user))?\.(css|js|mjs)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}
