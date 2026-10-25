import { ClientError, ErrorCodes } from './errors.js';
import { cloneJSON, debounce } from './util.js';

const NAMESPACE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;

/** Keeps everything in memory. Used in tests and as the fallback when nothing else works. */
export class MemoryBackend {
  constructor(initial = {}) {
    this.data = new Map(Object.entries(initial));
  }

  read(namespace) {
    return this.data.get(namespace) ?? null;
  }

  write(namespace, data) {
    this.data.set(namespace, data);
  }
}

/** The browser's localStorage, one key per namespace. */
export class LocalStorageBackend {
  constructor(prefix) {
    this.prefix = prefix;
  }

  read(namespace) {
    const text = globalThis.localStorage?.getItem(this.prefix + namespace);
    return text ? JSON.parse(text) : null;
  }

  write(namespace, data) {
    globalThis.localStorage.setItem(this.prefix + namespace, JSON.stringify(data));
  }
}

/**
 * Desktop: files in the client app's data folder, written by the main process. Everything is read once
 * at startup (the snapshot the preload hands over), so reads stay synchronous.
 */
export class NativeBackend {
  constructor(native, snapshot = {}) {
    this.native = native;
    this.snapshot = snapshot;
  }

  read(namespace) {
    return this.snapshot[namespace] ?? null;
  }

  write(namespace, data, { sync = false } = {}) {
    this.snapshot[namespace] = data;
    return this.native.storageWrite(namespace, JSON.stringify(data), sync);
  }
}

/**
 * One namespace of saved values. Values are JSON, copied on the way in and out, so changing an object
 * you got from `get` doesn't change what's stored until you `set` it.
 */
export class Store {
  #data;
  #backend;
  #listeners = new Set();
  #save;
  #onError;
  #maxBytes;

  constructor(backend, namespace, { onError, maxBytes = 2_000_000, delay = 250 } = {}) {
    if (!NAMESPACE.test(namespace)) throw new ClientError(ErrorCodes.Storage, `Invalid storage namespace "${namespace}"`);
    this.namespace = namespace;
    this.#backend = backend;
    this.#onError = onError ?? ((error) => console.error(error));
    this.#maxBytes = maxBytes;
    try {
      const loaded = backend.read(namespace);
      this.#data = loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {};
    } catch (cause) {
      this.#onError(new ClientError(ErrorCodes.Storage, `Couldn't read storage "${namespace}"; starting empty`, { cause }));
      this.#data = {};
    }
    this.#save = debounce((options) => this.#write(options), delay);
  }

  #write(options) {
    try {
      const out = this.#backend.write(this.namespace, this.#data, options);
      if (out && typeof out.catch === 'function') out.catch((cause) => this.#onError(new ClientError(ErrorCodes.Storage, `Couldn't save "${this.namespace}"`, { cause })));
    } catch (cause) {
      this.#onError(new ClientError(ErrorCodes.Storage, `Couldn't save "${this.namespace}"`, { cause }));
    }
  }

  get(key, fallback = undefined) {
    if (!Object.hasOwn(this.#data, key)) return fallback;
    const value = this.#data[key];
    return value !== null && typeof value === 'object' ? cloneJSON(value) : value;
  }

  has(key) {
    return Object.hasOwn(this.#data, key);
  }

  set(key, value) {
    if (typeof key !== 'string' || !key) throw new ClientError(ErrorCodes.Storage, 'Storage keys are non-empty strings');
    const copy = cloneJSON(value, `storage value "${key}"`);
    const old = this.#data[key];
    const next = { ...this.#data, [key]: copy };
    if (JSON.stringify(next).length > this.#maxBytes) {
      throw new ClientError(ErrorCodes.Storage, `Storage "${this.namespace}" would go over ${Math.round(this.#maxBytes / 1000)} kB`);
    }
    this.#data = next;
    this.#save();
    this.#notify(key, copy, old);
    return this;
  }

  /** set(key, fn(current)) */
  update(key, fn, fallback) {
    return this.set(key, fn(this.get(key, fallback)));
  }

  delete(key) {
    if (!Object.hasOwn(this.#data, key)) return false;
    const old = this.#data[key];
    const { [key]: _removed, ...rest } = this.#data;
    this.#data = rest;
    this.#save();
    this.#notify(key, undefined, old);
    return true;
  }

  keys() {
    return Object.keys(this.#data);
  }

  all() {
    return cloneJSON(this.#data);
  }

  clear() {
    const keys = this.keys();
    this.#data = {};
    this.#save();
    for (const key of keys) this.#notify(key, undefined, undefined);
  }

  /** fn(key, value, oldValue) on every change; returns an unsubscribe function. */
  onChange(fn) {
    const entry = { fn };
    this.#listeners.add(entry);
    return () => this.#listeners.delete(entry);
  }

  flush({ sync = false } = {}) {
    this.#save.flush({ sync });
  }

  #notify(key, value, old) {
    for (const { fn } of [...this.#listeners]) {
      try {
        fn(key, value, old);
      } catch (error) {
        this.#onError(error);
      }
    }
  }
}

/** Hands out one Store per namespace and flushes them all when the page goes away. */
export class StorageManager {
  #stores = new Map();

  constructor(backend, { onError } = {}) {
    this.backend = backend;
    this.onError = onError;
  }

  namespace(name) {
    let store = this.#stores.get(name);
    if (!store) this.#stores.set(name, (store = new Store(this.backend, name, { onError: this.onError })));
    return store;
  }

  flushAll(options) {
    for (const store of this.#stores.values()) store.flush(options);
  }
}
