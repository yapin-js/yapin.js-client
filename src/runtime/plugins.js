import { ClientError, ErrorCodes, tagError } from './errors.js';
import { idFromFile, parseMeta } from './meta.js';
import { Settings } from './settings.js';
import { StyleOrder } from './themes.js';
import { h } from './ui.js';
import { compareVersions, isPlainObject, sortByDependencies, toArray } from './util.js';
import { apiVersion as currentApiVersion, idPattern } from '../shared/constants.js';

const DEFINITION = Symbol.for('yapin-client.plugin');

/** Marks an object as a plugin definition (and gives editors the types). Returns it unchanged. */
export function definePlugin(definition) {
  if (definition && typeof definition === 'object') Object.defineProperty(definition, DEFINITION, { value: true });
  return definition;
}

/**
 * What a plugin's start(ctx) gets. Everything registered through ctx (listeners, styles, patches,
 * observers, timers, pages, badges, themes) is undone automatically when the plugin stops, so most
 * plugins never need a stop() at all.
 */
export class PluginContext {
  #record;
  #manager;

  constructor(manager, record) {
    this.#manager = manager;
    this.#record = record;
    const client = manager.client;
    this.client = client;
    this.id = record.id;
    this.plugin = manager.info(record.id);
    this.logger = client.logger.child(record.id);
    this.settings = record.settings;
    this.storage = client.storage.namespace(`plugin.${record.id}`);
    this.ui = client.ui;
    this.h = h;
    this.host = client.host;
    this.dom = { observe: (selector, fn, options) => this.observe(selector, fn, options), waitFor: (selector, options) => client.dom.waitFor(selector, options) };
    this.react = client.react;
    this.modules = client.modules;
    this.api = client.api;
    const owner = record;
    this.patch = {
      before: (target, key, fn) => client.patcher.before(target, key, fn, { owner }),
      after: (target, key, fn) => client.patcher.after(target, key, fn, { owner }),
      instead: (target, key, fn) => client.patcher.instead(target, key, fn, { owner }),
    };
    this.pages = {
      add: (definition) => this.#track(client.pages.add(definition, { owner }).remove),
      get: (id) => client.pages.get(id),
    };
    this.badges = {
      addProvider: (provider) => this.#track(client.badges.addProvider(provider, { owner })),
      add: (userId, badge) => this.#track(client.badges.add(userId, badge, { owner })),
    };
    this.themes = {
      add: (definition) => this.#track(client.themes.add(definition, { source: 'code', owner }).remove),
    };
  }

  #track(dispose) {
    if (typeof dispose === 'function') this.#record.disposers.push(dispose);
    return dispose;
  }

  /** Adds CSS while the plugin runs. Returns { update(css), remove() }. */
  css(text) {
    const handle = this.client.styles.add(text, { id: `plugin:${this.id}`, order: StyleOrder.plugin });
    this.#track(handle.remove);
    return handle;
  }

  /** Calls fn(element) for every element matching `selector`, now and later. See DomWatcher.observe. */
  observe(selector, fn, options) {
    const wrapped = (element) => this.#manager.guard(this.#record, `observe ${selector}`, () => fn(element, this));
    return this.#track(this.client.dom.observe(selector, wrapped, options));
  }

  /** Listens to a client event ('ready', 'settings:open', 'page:open', 'theme:enable', …). */
  on(event, fn) {
    return this.#track(this.client.events.on(event, (...args) => this.#manager.guard(this.#record, `event ${event}`, () => fn(...args))));
  }

  /** addEventListener that's removed when the plugin stops. */
  listen(target, type, fn, options) {
    const wrapped = (event) => this.#manager.guard(this.#record, `${type} listener`, () => fn(event));
    target.addEventListener(type, wrapped, options);
    return this.#track(() => target.removeEventListener(type, wrapped, options));
  }

  setTimeout(fn, ms) {
    const timer = setTimeout(() => this.#manager.guard(this.#record, 'timeout', fn), ms);
    this.#track(() => clearTimeout(timer));
    return timer;
  }

  setInterval(fn, ms) {
    const timer = setInterval(() => this.#manager.guard(this.#record, 'interval', fn), ms);
    this.#track(() => clearInterval(timer));
    return timer;
  }

  /** Runs fn when the plugin stops. */
  onStop(fn) {
    this.#track(fn);
    return this;
  }

  toast(message, options) {
    return this.ui.toast(message, options);
  }
}

/**
 * Loads, starts and stops plugins, keeps their enabled state, and isolates their failures. A plugin
 * that throws more than `crashLimit` times within `crashWindow` ms is stopped for the rest of the
 * session, so one broken plugin can't take the client down.
 */
export class PluginManager {
  #plugins = new Map();
  #store;
  #loadModule;

  constructor(client, config = {}, { loadModule } = {}) {
    this.client = client;
    this.config = config;
    this.crashLimit = config.crash?.limit ?? 3;
    this.crashWindow = config.crash?.window ?? 60_000;
    this.#store = client.storage.namespace('plugins');
    this.#loadModule = loadModule ?? blobImport;
  }

  /** Registers a plugin definition without starting it. */
  add(definition, { source = 'code', file = null, owner = null, text = null } = {}) {
    const record = this.#normalize(definition, { source, file, text });
    const existing = this.#plugins.get(record.id);
    if (existing) {
      if (existing.source !== record.source || source === 'bundled') {
        throw new ClientError(ErrorCodes.DuplicateId, `A ${existing.source} plugin with id "${record.id}" already exists`);
      }
      this.stop(record.id);
    }
    record.owner = owner;
    this.#plugins.set(record.id, record);
    this.client.events.emit(existing ? 'plugin:update' : 'plugin:add', record.id);
    return this.#handle(record.id);
  }

  /**
   * Loads a plugin from source text (an ES module whose default export is the definition, or a
   * function returning it). The metadata header fills in anything the definition leaves out.
   */
  async addSource(text, { file = null, source = 'user' } = {}) {
    if (typeof text !== 'string' || !text.trim()) throw new ClientError(ErrorCodes.LoadFailed, `${file ?? 'plugin'} is empty`);
    const { meta } = parseMeta(text);
    let mod;
    try {
      mod = await this.#loadModule(text, file);
    } catch (cause) {
      throw new ClientError(ErrorCodes.LoadFailed, `Couldn't load ${file ?? 'plugin'}: ${cause?.message ?? cause}`, { cause });
    }
    let definition = mod?.default ?? mod?.plugin ?? mod;
    if (typeof definition === 'function' && !definition.prototype?.start) definition = await definition(this.client);
    if (!isPlainObject(definition) && !definition?.[DEFINITION]) throw new ClientError(ErrorCodes.InvalidDefinition, `${file ?? 'plugin'} doesn't export a plugin (export default { id, name, start() {} })`);
    const merged = { ...meta, ...definition, id: definition.id ?? meta.id ?? (file ? idFromFile(file) : undefined) };
    delete merged.extra;
    return this.add(merged, { source, file, text });
  }

  remove(id) {
    const record = this.#plugins.get(id);
    if (!record) return false;
    this.stop(id);
    this.#plugins.delete(id);
    this.client.events.emit('plugin:remove', id);
    return true;
  }

  removeOwned(owner) {
    for (const record of [...this.#plugins.values()]) if (record.owner === owner) this.remove(record.id);
  }

  has(id) {
    return this.#plugins.has(id);
  }

  get(id) {
    return this.#plugins.has(id) ? this.#handle(id) : null;
  }

  /** Public information about one plugin. */
  info(id) {
    const r = this.#require(id);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      version: r.version,
      authors: r.authors,
      tags: r.tags,
      website: r.website,
      source: r.source,
      file: r.file,
      required: r.required,
      hidden: r.hidden,
      dependencies: r.dependencies,
      status: r.status,
      error: r.error ? String(r.error.message ?? r.error) : null,
      enabled: this.isEnabled(r.id),
      hasSettings: Object.keys(r.settings.definitions).length > 0,
      compatible: r.incompatible === null,
      incompatible: r.incompatible,
    };
  }

  list({ includeHidden = false } = {}) {
    return [...this.#plugins.values()]
      .filter((r) => includeHidden || !r.hidden)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => this.info(r.id));
  }

  isEnabled(id) {
    const record = this.#plugins.get(id);
    if (!record) return false;
    if (record.required) return true;
    const saved = this.#store.get('enabled', {});
    if (Object.hasOwn(saved, id)) return Boolean(saved[id]);
    return Boolean(this.config.enabled?.[id] ?? record.enabledByDefault);
  }

  isRunning(id) {
    return this.#plugins.get(id)?.status === 'running';
  }

  /** Turns a plugin on (and the plugins it depends on), and remembers that. */
  async enable(id) {
    const record = this.#require(id);
    if (record.incompatible) throw new ClientError(ErrorCodes.Unsupported, `${record.name} can't run here: ${record.incompatible}`);
    for (const dep of record.dependencies) if (!this.isEnabled(dep)) await this.enable(dep);
    for (const other of record.conflicts) {
      if (this.isRunning(other)) throw new ClientError(ErrorCodes.Dependency, `${record.name} can't run together with ${this.#plugins.get(other)?.name ?? other}`);
    }
    this.#saveEnabled(id, true);
    if (this.started) await this.start(id);
    this.client.events.emit('plugin:enable', id);
    return true;
  }

  /** Turns a plugin off (and the plugins that depend on it), and remembers that. */
  async disable(id) {
    const record = this.#require(id);
    if (record.required) throw new ClientError(ErrorCodes.NotAllowed, `${record.name} is required by ${this.client.name} and can't be turned off`);
    for (const other of this.#plugins.values()) if (other.dependencies.includes(id) && this.isEnabled(other.id)) await this.disable(other.id);
    this.#saveEnabled(id, false);
    this.stop(id);
    this.client.events.emit('plugin:disable', id);
    return true;
  }

  toggle(id, on = !this.isEnabled(id)) {
    return on ? this.enable(id) : this.disable(id);
  }

  #saveEnabled(id, on) {
    this.#store.update('enabled', (saved) => ({ ...saved, [id]: on }), {});
  }

  started = false;

  /** Starts every enabled plugin, dependencies first. In safe mode, none start. */
  async startAll() {
    this.started = true;
    if (this.client.safeMode) return [];
    const compatible = [...this.#plugins.values()].filter((r) => !r.incompatible);
    const { sorted, problems } = sortByDependencies(compatible, { deps: (r) => r.dependencies });
    for (const problem of problems) {
      const record = this.#plugins.get(problem.id);
      if (record && this.isEnabled(record.id)) {
        record.status = 'error';
        record.error = new ClientError(ErrorCodes.Dependency, problem.reason);
        this.client.logger.warn(`${record.name} not started: ${problem.reason}`);
      }
    }
    const started = [];
    for (const record of sorted) {
      if (this.isEnabled(record.id) && record.status !== 'running' && (await this.start(record.id))) started.push(record.id);
    }
    return started;
  }

  stopAll() {
    for (const record of [...this.#plugins.values()].reverse()) this.stop(record.id);
    this.started = false;
  }

  /** Starts one plugin now (whether or not it's enabled). Resolves true if it's running. */
  async start(id) {
    const record = this.#require(id);
    if (record.status === 'running' || record.status === 'starting') return true;
    if (this.client.safeMode) return false;
    if (record.incompatible) return false;
    for (const dep of record.dependencies) {
      if (!this.isRunning(dep) && !(await this.start(dep))) {
        record.status = 'error';
        record.error = new ClientError(ErrorCodes.Dependency, `needs ${dep}, which didn't start`);
        return false;
      }
    }
    record.status = 'starting';
    record.error = null;
    record.disposers = [];
    const ctx = new PluginContext(this, record);
    record.ctx = ctx;
    try {
      const def = record.definition;
      if (def.styles) {
        const sheet = ctx.css(typeof def.styles === 'function' ? def.styles(record.settings.all()) : def.styles);
        if (typeof def.styles === 'function') record.disposers.push(record.settings.onChange('*', () => sheet.update(def.styles(record.settings.all()))));
      }
      for (const [event, fn] of Object.entries(def.events ?? {})) ctx.on(event, fn.bind(def));
      for (const [selector, fn] of Object.entries(def.observe ?? {})) ctx.observe(selector, fn.bind(def));
      if (typeof def.onSettingsChange === 'function') {
        record.disposers.push(record.settings.onChange('*', (value, old, key) => this.guard(record, 'onSettingsChange', () => def.onSettingsChange.call(def, key, value, ctx, old))));
      }
      if (def.page) ctx.pages.add({ id: record.id, title: record.name, ...def.page });
      if (def.badges) for (const provider of toArray(def.badges)) ctx.badges.addProvider(provider);
      for (const patch of def.patches ?? []) await this.#applyPatch(record, ctx, patch);
      if (typeof def.start === 'function') await def.start.call(def, ctx);
      record.status = 'running';
      this.client.events.emit('plugin:start', id);
      return true;
    } catch (error) {
      this.#cleanup(record);
      record.status = 'error';
      record.error = error;
      this.client.reportError(tagError(error, { plugin: id, where: 'start' }));
      this.client.events.emit('plugin:error', id, error);
      return false;
    }
  }

  /** Stops a plugin: runs stop(), then undoes everything it registered. */
  stop(id) {
    const record = this.#plugins.get(id);
    if (!record || (record.status !== 'running' && record.status !== 'starting')) return false;
    for (const other of this.#plugins.values()) if (other.dependencies.includes(id) && this.isRunning(other.id)) this.stop(other.id);
    try {
      record.definition.stop?.call(record.definition, record.ctx);
    } catch (error) {
      this.client.reportError(tagError(error, { plugin: id, where: 'stop' }));
    }
    this.#cleanup(record);
    record.status = 'stopped';
    this.client.events.emit('plugin:stop', id);
    return true;
  }

  async restart(id) {
    this.stop(id);
    return this.start(id);
  }

  /**
   * Runs fn on behalf of a plugin, reporting what it throws (or rejects with). Too many failures in a
   * short time stop the plugin for this session.
   */
  guard(record, where, fn) {
    try {
      const out = fn();
      if (out && typeof out.catch === 'function') out.catch((error) => this.#crash(record, where, error));
      return out;
    } catch (error) {
      this.#crash(record, where, error);
      return undefined;
    }
  }

  #crash(record, where, error) {
    this.client.reportError(tagError(error, { plugin: record.id, where }));
    const now = Date.now();
    record.crashes = record.crashes.filter((t) => now - t < this.crashWindow);
    record.crashes.push(now);
    if (record.crashes.length >= this.crashLimit && record.status === 'running') {
      this.stop(record.id);
      record.status = 'crashed';
      record.error = error;
      this.client.events.emit('plugin:crash', record.id, error);
      this.client.ui.toast(`${record.name} kept failing and was stopped. Check the console for details.`, { type: 'error', timeout: 8000 });
    }
  }

  async #applyPatch(record, ctx, patch) {
    const where = `patch ${patch.method ?? ''}`;
    let target = null;
    if (typeof patch.find === 'function') target = await patch.find(this.client.modules, ctx);
    else if (patch.find?.props) target = patch.wait ? await this.client.modules.waitFor(this.client.modules.filters.byProps(...patch.find.props), { timeout: patch.timeout ?? 15_000 }) : this.client.modules.findByProps(...patch.find.props);
    else if (patch.find?.code) target = patch.wait ? await this.client.modules.waitFor(this.client.modules.filters.byCode(...patch.find.code), { timeout: patch.timeout ?? 15_000 }) : this.client.modules.findByCode(...patch.find.code);
    else if (patch.target) target = patch.target;
    if (!target) {
      const message = `${record.name}: couldn't find what "${where}" patches; Yapin’ may have changed`;
      if (patch.optional) {
        ctx.logger.warn(message);
        return;
      }
      throw new ClientError(ErrorCodes.NotFound, message);
    }
    for (const type of ['before', 'instead', 'after']) {
      if (typeof patch[type] === 'function') ctx.patch[type](target, patch.method, (...args) => this.guard(record, where, () => patch[type].call(record.definition, ...args, ctx)));
    }
  }

  #cleanup(record) {
    for (const dispose of (record.disposers ?? []).splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        this.client.reportError(tagError(error, { plugin: record.id, where: 'cleanup' }));
      }
    }
    this.client.patcher.unpatchAll(record);
    record.ctx = null;
  }

  #normalize(def, { source, file, text }) {
    if (!def || typeof def !== 'object') throw new ClientError(ErrorCodes.InvalidDefinition, `${file ?? 'A plugin'} has no definition object`);
    const id = def.id;
    if (!idPattern.test(id ?? '')) throw new ClientError(ErrorCodes.InvalidDefinition, `Plugin id "${id}" must be lowercase letters, digits and dashes${file ? ` (${file})` : ''}`);
    for (const fn of ['start', 'stop', 'onSettingsChange']) {
      if (def[fn] !== undefined && typeof def[fn] !== 'function') throw new ClientError(ErrorCodes.InvalidDefinition, `Plugin "${id}": ${fn} must be a function`);
    }
    if (def.page && typeof def.page.render !== 'function') throw new ClientError(ErrorCodes.InvalidDefinition, `Plugin "${id}": page needs a render function`);
    const authors = toArray(def.authors ?? def.author).map((a) => (typeof a === 'string' ? { name: a } : a)).filter((a) => a && a.name);
    const settings = new Settings(def.settings ?? {}, this.client.storage.namespace(`plugin.${id}.settings`), {
      owner: `plugin ${id}`,
      onError: (error) => this.client.reportError(tagError(error, { plugin: id })),
    });
    const blocked = toArray(this.config.blocked).includes(id);
    const wanted = Number(def.apiVersion ?? currentApiVersion);
    let incompatible = null;
    if (blocked) incompatible = `blocked by ${this.client.name}`;
    else if (!Number.isFinite(wanted) || wanted > currentApiVersion) incompatible = `written for plugin API ${def.apiVersion}, this client has ${currentApiVersion}`;
    else if (def.platforms && !toArray(def.platforms).includes(this.client.host.platform)) incompatible = `only runs on ${toArray(def.platforms).join(' and ')}`;
    else if (def.minClientVersion && compareVersions(this.client.version, def.minClientVersion) < 0) incompatible = `needs ${this.client.name} ${def.minClientVersion} or newer`;
    return {
      id,
      name: String(def.name ?? id),
      description: String(def.description ?? ''),
      version: def.version ?? null,
      authors,
      tags: toArray(def.tags),
      website: def.website ?? def.source ?? null,
      dependencies: toArray(def.dependencies),
      conflicts: toArray(def.conflicts),
      required: toArray(this.config.required).includes(id) || (source === 'bundled' && def.required === true),
      hidden: toArray(this.config.hidden).includes(id) || def.hidden === true,
      enabledByDefault: def.enabledByDefault === true,
      definition: def,
      settings,
      source,
      file,
      text,
      status: incompatible ? 'incompatible' : 'stopped',
      incompatible,
      error: null,
      crashes: [],
      disposers: [],
      ctx: null,
      owner: null,
    };
  }

  #require(id) {
    const record = this.#plugins.get(id);
    if (!record) throw new ClientError(ErrorCodes.NotFound, `No plugin "${id}"`);
    return record;
  }

  #handle(id) {
    return {
      id,
      info: () => this.info(id),
      enable: () => this.enable(id),
      disable: () => this.disable(id),
      toggle: (on) => this.toggle(id, on),
      start: () => this.start(id),
      stop: () => this.stop(id),
      restart: () => this.restart(id),
      remove: () => this.remove(id),
      settings: this.#plugins.get(id).settings,
    };
  }

  /** The source text of a user plugin (for reinstalling or showing it). */
  sourceOf(id) {
    return this.#require(id).text;
  }
}

/** Imports module source text through a blob: URL, so plugins are real ES modules. */
async function blobImport(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
