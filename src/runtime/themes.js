import { ClientError, ErrorCodes } from './errors.js';
import { parseMeta, idFromFile } from './meta.js';
import { Settings } from './settings.js';
import { isPlainObject } from './util.js';
import { idPattern } from '../shared/constants.js';

/**
 * Selector used for variable overrides. Yapin’ sets its variables on `:root`, `:root[data-theme=light]`,
 * `:root[data-tint]`, `:root[data-srv-tint]` and combinations (up to three classes/attributes of
 * specificity); repeating :root four times beats all of them without !important.
 */
export const VARIABLE_SELECTOR = ':root:root:root:root';
const UNSAFE_VALUE = /[;{}]|<\/|\/\*|\*\//;

/** Order of the framework's stylesheets in the cascade (later wins). */
export const StyleOrder = Object.freeze({ framework: 0, plugin: 20, base: 50, theme: 100, custom: 10_000 });

function cssValue(def, value) {
  if (value === undefined || value === null) return null;
  let text;
  if (def.type === 'switch') text = value ? def.on ?? '1' : def.off ?? '0';
  else if (def.type === 'number' || def.type === 'slider') text = `${value}${def.unit ?? ''}`;
  else text = String(value);
  return UNSAFE_VALUE.test(text) ? null : text;
}

/** `{ '--a': 'x' }` or `{ dark: {…}, light: {…} }` → CSS text. */
export function variablesCSS(variables) {
  if (!isPlainObject(variables)) return '';
  const block = (selector, vars) => {
    const lines = Object.entries(vars)
      .filter(([name, value]) => name.startsWith('--') && value !== null && value !== undefined && !UNSAFE_VALUE.test(String(value)))
      .map(([name, value]) => `  ${name}: ${value};`);
    return lines.length ? `${selector} {\n${lines.join('\n')}\n}` : '';
  };
  const out = [];
  const flat = Object.fromEntries(Object.entries(variables).filter(([key]) => key.startsWith('--')));
  out.push(block(VARIABLE_SELECTOR, flat));
  if (isPlainObject(variables.dark)) out.push(block(`${VARIABLE_SELECTOR}:not([data-theme=light])`, variables.dark));
  if (isPlainObject(variables.light)) out.push(block(`${VARIABLE_SELECTOR}[data-theme=light]`, variables.light));
  return out.filter(Boolean).join('\n');
}

/** Theme `@var`s (or a settings schema with `variable` keys) → a settings schema. */
function varsToSchema(vars) {
  const schema = {};
  for (const v of vars) {
    const key = v.key ?? v.variable.replace(/^--/, '');
    const type = v.type === 'color' || v.type === 'number' || v.type === 'slider' || v.type === 'select' || v.type === 'switch' || v.type === 'text' ? v.type : 'text';
    const def = { ...v, type, label: v.label ?? v.variable };
    if (type === 'select') def.options = v.options ?? [v.default];
    if (type === 'slider') {
      def.min ??= 0;
      def.max ??= 100;
    }
    if (def.default === undefined || (typeof def.default === 'number' && Number.isNaN(def.default))) delete def.default;
    schema[key] = def;
  }
  return schema;
}

/**
 * Themes are CSS. They come from three places:
 * - bundled: in the client app's `themes/` folder, built in;
 * - user: installed by the person using the client (a folder on desktop, saved in the browser on web);
 * - code: `client.themes.add({ … })` from the client app or a plugin.
 *
 * A theme can declare variables (`@var` in its header, or `vars` in code) that show up as settings,
 * so people can change colours and sizes without editing CSS.
 */
export class ThemeManager {
  #themes = new Map();
  #applied = new Map();
  #base = null;
  #custom = null;
  #store;

  constructor(client, config = {}) {
    this.client = client;
    this.config = config;
    this.#store = client.storage.namespace('themes');
  }

  get multiple() {
    return this.config.multiple !== false;
  }

  /** Ids of enabled themes, in the order they apply (later wins). */
  get enabledIds() {
    const saved = this.#store.get('enabled');
    if (Array.isArray(saved)) return saved.filter((id) => this.#themes.has(id));
    const defaults = this.config.enabled ?? {};
    return [...this.#themes.values()].filter((t) => defaults[t.id] ?? t.enabledByDefault).map((t) => t.id);
  }

  /** Parses a theme file (CSS with a metadata header). */
  parse(text, { file, source = 'user' } = {}) {
    const { meta, vars } = parseMeta(text);
    const id = meta.id ?? (file ? idFromFile(file) : null);
    return { ...meta, id, css: text, vars, source, file };
  }

  add(definition, { source = 'code', file = null, owner = null } = {}) {
    const theme = this.#normalize(definition, { source, file, owner });
    const existing = this.#themes.get(theme.id);
    if (existing && existing.source !== theme.source) {
      throw new ClientError(ErrorCodes.DuplicateId, `A ${existing.source} theme with id "${theme.id}" already exists`);
    }
    if (existing) {
      this.#unapply(theme.id);
      existing.unsubscribe?.();
    }
    this.#themes.set(theme.id, theme);
    if (this.#started && this.isEnabled(theme.id)) this.#apply(theme);
    this.client.events.emit(existing ? 'theme:update' : 'theme:add', theme.id);
    return this.#handle(theme.id);
  }

  remove(id) {
    const theme = this.#themes.get(id);
    if (!theme) return false;
    this.#unapply(id);
    theme.unsubscribe?.();
    this.#themes.delete(id);
    this.client.events.emit('theme:remove', id);
    return true;
  }

  removeOwned(owner) {
    for (const theme of [...this.#themes.values()]) if (theme.owner === owner) this.remove(theme.id);
  }

  get(id) {
    return this.#themes.has(id) ? this.#handle(id) : null;
  }

  has(id) {
    return this.#themes.has(id);
  }

  list() {
    return [...this.#themes.values()]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
      .map((t) => ({ ...this.#info(t), enabled: this.isEnabled(t.id) }));
  }

  isEnabled(id) {
    return this.enabledIds.includes(id);
  }

  enable(id) {
    const theme = this.#require(id);
    let ids = this.enabledIds.filter((x) => x !== id);
    if (!this.multiple) {
      for (const other of ids) this.#unapply(other);
      ids = [];
    }
    ids.push(id);
    this.#store.set('enabled', ids);
    if (this.#started) this.#apply(theme);
    this.client.events.emit('theme:enable', id);
    return true;
  }

  disable(id) {
    this.#require(id);
    this.#store.set('enabled', this.enabledIds.filter((x) => x !== id));
    this.#unapply(id);
    this.client.events.emit('theme:disable', id);
    return true;
  }

  toggle(id, on = !this.isEnabled(id)) {
    return on ? this.enable(id) : this.disable(id);
  }

  /** The theme's variable settings (empty if it declares none). */
  settings(id) {
    return this.#require(id).settings;
  }

  /** The custom CSS everyone can type into the Themes page (if the client app allows it). */
  get customCSS() {
    return this.#store.get('customCSS', '');
  }

  set customCSS(css) {
    this.#store.set('customCSS', String(css ?? ''));
    this.#custom?.update(this.customCSS);
  }

  #started = false;

  /** Applies the base styles, enabled themes and custom CSS. In safe mode, nothing is applied. */
  start() {
    if (this.#started) return;
    this.#started = true;
    if (this.client.safeMode) return;
    const baseCSS = [this.config.baseCSS ?? '', variablesCSS(this.config.variables)].filter(Boolean).join('\n');
    if (baseCSS) this.#base = this.client.styles.add(baseCSS, { id: 'base', order: StyleOrder.base });
    for (const id of this.enabledIds) this.#apply(this.#themes.get(id));
    if (this.config.customCSS?.enabled !== false) this.#custom = this.client.styles.add(this.customCSS, { id: 'custom', order: StyleOrder.custom });
  }

  stop() {
    for (const id of [...this.#applied.keys()]) this.#unapply(id);
    this.#base?.remove();
    this.#custom?.remove();
    this.#base = this.#custom = null;
    this.#started = false;
  }

  #normalize(def, { source, file, owner }) {
    if (!def || typeof def !== 'object') throw new ClientError(ErrorCodes.InvalidDefinition, 'A theme needs a definition object');
    if (!idPattern.test(def.id ?? '')) throw new ClientError(ErrorCodes.InvalidDefinition, `Theme id "${def.id}" must be lowercase letters, digits and dashes${file ? ` (${file})` : ''}`);
    if (typeof def.css !== 'string' && !isPlainObject(def.variables)) throw new ClientError(ErrorCodes.InvalidDefinition, `Theme "${def.id}" needs css or variables`);
    const vars = Array.isArray(def.vars) ? def.vars : [];
    const schema = { ...varsToSchema(vars), ...(isPlainObject(def.settings) ? def.settings : {}) };
    const settings = new Settings(schema, this.client.storage.namespace(`theme.${def.id}`), { owner: `theme ${def.id}`, onError: (e) => this.client.reportError(e, { theme: def.id }) });
    const theme = {
      id: def.id,
      name: String(def.name ?? def.id),
      description: def.description ?? '',
      version: def.version ?? null,
      authors: def.authors ?? [],
      tags: def.tags ?? [],
      mode: def.mode ?? 'any',
      preview: def.preview ?? null,
      website: def.website ?? def.source ?? null,
      css: def.css ?? '',
      variables: def.variables ?? null,
      enabledByDefault: Boolean(def.enabledByDefault),
      order: Number(def.order ?? 0),
      source,
      file: file ?? def.file ?? null,
      owner,
      settings,
      unsubscribe: null,
    };
    theme.unsubscribe = settings.onChange('*', () => {
      const applied = this.#applied.get(theme.id);
      if (applied) applied.update(this.#css(theme));
    });
    return theme;
  }

  #css(theme) {
    const parts = [theme.css, variablesCSS(theme.variables)];
    const declarations = [];
    for (const [key, def] of Object.entries(theme.settings.definitions)) {
      if (!def.variable) continue;
      const value = cssValue(def, theme.settings.get(key));
      if (value !== null) declarations.push(`  ${def.variable}: ${value};`);
    }
    if (declarations.length) parts.push(`${VARIABLE_SELECTOR} {\n${declarations.join('\n')}\n}`);
    return parts.filter(Boolean).join('\n');
  }

  #apply(theme) {
    if (!theme || this.client.safeMode) return;
    this.#unapply(theme.id);
    const position = this.enabledIds.indexOf(theme.id);
    const handle = this.client.styles.add(this.#css(theme), { id: `theme:${theme.id}`, order: StyleOrder.theme + Math.max(0, position) });
    this.#applied.set(theme.id, handle);
    if (handle.error) this.client.reportError(handle.error, { theme: theme.id });
  }

  #unapply(id) {
    this.#applied.get(id)?.remove();
    this.#applied.delete(id);
  }

  #require(id) {
    const theme = this.#themes.get(id);
    if (!theme) throw new ClientError(ErrorCodes.NotFound, `No theme "${id}"`);
    return theme;
  }

  #info(theme) {
    const { settings: _s, unsubscribe: _u, css: _c, owner: _o, ...info } = theme;
    return { ...info, hasSettings: Object.keys(theme.settings.definitions).length > 0 };
  }

  #handle(id) {
    return {
      id,
      enable: () => this.enable(id),
      disable: () => this.disable(id),
      toggle: (on) => this.toggle(id, on),
      remove: () => this.remove(id),
      isEnabled: () => this.isEnabled(id),
      settings: this.#themes.get(id).settings,
      info: () => this.#info(this.#require(id)),
    };
  }
}
