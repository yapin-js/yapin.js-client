const HOOK = Symbol.for('yapin-client.turbopack');
const ORIGINAL = Symbol.for('yapin-client.factory');

/**
 * Hooks Turbopack, the bundler Yapin’s web app is built with, so the app's own modules (stores, helpers,
 * components) can be found at runtime.
 *
 * Every chunk registers itself with `globalThis.TURBOPACK.push([script, id, factory, id, factory, …])`.
 * Before Turbopack's runtime loads, TURBOPACK is a plain array; the runtime then replaces it with
 * `{ push }` and replays the array. A setter on `TURBOPACK` lets us wrap every factory either way. When a
 * wrapped factory runs, its first argument is Turbopack's module context, whose `c` is the module cache
 * (a Map of id → { exports }). That cache is what the finder searches.
 *
 * This must run before the page's scripts to see every module. Installed later, it still sees every
 * module loaded from then on, and the whole cache as soon as any new module loads.
 */
export function installTurbopackHook(g = globalThis) {
  if (g[HOOK]) return g[HOOK];
  const hook = {
    cache: null,
    factories: new Map(),
    listeners: new Set(),
    early: !g.TURBOPACK || Array.isArray(g.TURBOPACK),
    errors: [],
  };

  const notify = (id) => {
    for (const listener of [...hook.listeners]) {
      try {
        listener(id);
      } catch (error) {
        hook.errors.push(error);
      }
    }
  };

  const wrapFactory = (id, factory) => {
    if (factory[ORIGINAL]) return factory;
    hook.factories.set(id, factory);
    const wrapped = function (...args) {
      const ctx = args[0];
      if (!hook.cache && ctx && ctx.c instanceof Map) hook.cache = ctx.c;
      try {
        return factory.apply(this, args);
      } finally {
        if (hook.listeners.size) notify(id);
      }
    };
    Object.defineProperty(wrapped, ORIGINAL, { value: factory });
    Object.defineProperty(wrapped, 'toString', { value: () => Function.prototype.toString.call(factory), configurable: true });
    return wrapped;
  };

  const wrapChunk = (chunk) => {
    if (!Array.isArray(chunk)) return chunk;
    for (let i = 1; i < chunk.length; i++) {
      if (typeof chunk[i] === 'function') chunk[i] = wrapFactory(chunk[i - 1], chunk[i]);
    }
    return chunk;
  };

  const wrapTarget = (value) => {
    if (!value || typeof value.push !== 'function' || value[HOOK]) return value;
    if (Array.isArray(value)) value.forEach(wrapChunk);
    const push = value.push;
    Object.defineProperty(value, 'push', {
      value: function (...chunks) {
        return push.apply(this, chunks.map(wrapChunk));
      },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(value, HOOK, { value: true });
    return value;
  };

  let current = wrapTarget(g.TURBOPACK);
  try {
    Object.defineProperty(g, 'TURBOPACK', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (value) => {
        current = wrapTarget(value);
      },
    });
  } catch (error) {
    hook.errors.push(error);
  }
  Object.defineProperty(g, HOOK, { value: hook });
  return hook;
}

export const filters = {
  /** Exports (or exports.default) that have all these properties. */
  byProps: (...props) => (exports) => exports !== null && (typeof exports === 'object' || typeof exports === 'function') && props.every((p) => p in exports),
  /** A function export whose source contains all these strings. */
  byCode: (...strings) => (exports) => typeof exports === 'function' && strings.every((s) => Function.prototype.toString.call(exports).includes(s)),
  /** A component or class by its displayName or name. */
  byName: (name) => (exports) => typeof exports === 'function' && (exports.displayName === name || exports.name === name),
};

/**
 * Finds the web app's modules. Module ids change on every deploy, so find things by what they look like
 * (their exports, or text in their code), never by id. Every result can be null: the app may have
 * changed, so check before using it.
 */
export class ModuleFinder {
  constructor(hook) {
    this.hook = hook;
    this.filters = filters;
  }

  /** True once the module cache has been seen. */
  get available() {
    return Boolean(this.hook?.cache);
  }

  /** [id, exports] for every loaded module. */
  *entries() {
    if (!this.hook?.cache) return;
    for (const [id, mod] of this.hook.cache) {
      let exports;
      try {
        exports = mod?.exports;
      } catch {
        continue;
      }
      if (exports !== undefined && exports !== null) yield [id, exports];
    }
  }

  #candidates(exports, { deep }) {
    const out = [exports];
    if (!deep || exports === null || typeof exports !== 'object') return out;
    for (const key of Object.keys(exports)) {
      try {
        const value = exports[key];
        if (value && (typeof value === 'object' || typeof value === 'function')) out.push(value);
      } catch {
        // a module that hasn't finished loading
      }
    }
    return out;
  }

  /**
   * The first export matching `filter`. Checks each module's exports and (with `deep`, the default)
   * each of its named exports, since bundled modules usually export many things.
   */
  find(filter, { deep = true, all = false } = {}) {
    const found = [];
    for (const [, exports] of this.entries()) {
      for (const candidate of this.#candidates(exports, { deep })) {
        let match = false;
        try {
          match = filter(candidate);
        } catch {
          match = false;
        }
        if (match) {
          if (!all) return candidate;
          found.push(candidate);
        }
      }
    }
    return all ? found : null;
  }

  findAll(filter, options) {
    return this.find(filter, { ...options, all: true });
  }

  findByProps(...props) {
    return this.find(filters.byProps(...props));
  }

  findByCode(...strings) {
    return this.find(filters.byCode(...strings));
  }

  /**
   * The exports of the module whose factory source contains all `strings`. Works even for modules
   * that export only plain values, since it searches the module's code, not its exports.
   */
  findModuleByCode(...strings) {
    if (!this.hook) return null;
    for (const [id, factory] of this.hook.factories) {
      const source = Function.prototype.toString.call(factory);
      if (strings.every((s) => source.includes(s))) {
        const mod = this.hook.cache?.get(id);
        if (mod) return mod.exports ?? null;
      }
    }
    return null;
  }

  /** Resolves when a module matching `filter` loads (or right away if one has). null after `timeout`. */
  waitFor(filter, { timeout = 0, deep = true } = {}) {
    const existing = this.find(filter, { deep });
    if (existing) return Promise.resolve(existing);
    if (!this.hook) return Promise.resolve(null);
    return new Promise((resolve) => {
      let timer = null;
      const listener = (id) => {
        const exports = this.hook.cache?.get(id)?.exports;
        if (exports === undefined || exports === null) return;
        const found = this.#candidates(exports, { deep }).find((candidate) => {
          try {
            return filter(candidate);
          } catch {
            return false;
          }
        });
        if (!found) return;
        this.hook.listeners.delete(listener);
        clearTimeout(timer);
        resolve(found);
      };
      this.hook.listeners.add(listener);
      if (timeout > 0) {
        timer = setTimeout(() => {
          this.hook.listeners.delete(listener);
          resolve(null);
        }, timeout);
      }
    });
  }

  /** A function that finds once, on first call, and remembers the result once it's found. */
  lazy(filter, options) {
    let cached = null;
    return () => (cached ??= this.find(filter, options));
  }
}
