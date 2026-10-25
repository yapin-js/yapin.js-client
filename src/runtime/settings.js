import { ClientError, ErrorCodes } from './errors.js';
import { cloneJSON } from './util.js';

const COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const KEY = /^[A-Za-z_$][\w$-]{0,63}$/;

function fail(owner, key, message) {
  return new ClientError(ErrorCodes.InvalidSetting, `${owner ? `${owner}: ` : ''}setting "${key}" ${message}`, { owner, key });
}

function normalizeOptions(options, owner, key) {
  if (!Array.isArray(options) || options.length === 0) throw fail(owner, key, 'needs a non-empty options array');
  return options.map((option) => {
    if (option !== null && typeof option === 'object') {
      if (!('value' in option)) throw fail(owner, key, 'has an option without a value');
      return { label: String(option.label ?? option.value), value: option.value, description: option.description };
    }
    return { label: String(option), value: option };
  });
}

/**
 * Each setting type: what a valid value is, how to coerce near misses (a number typed as text), and
 * a default when the definition has none.
 */
export const SettingTypes = {
  switch: {
    fallback: () => false,
    check(value) {
      if (typeof value !== 'boolean') return 'must be true or false';
      return true;
    },
  },
  text: {
    fallback: () => '',
    coerce: (value, def) => (typeof value === 'string' && def.trim ? value.trim() : value),
    check(value, def) {
      if (typeof value !== 'string') return 'must be text';
      if (def.minLength !== undefined && value.length < def.minLength) return `must be at least ${def.minLength} characters`;
      if (def.maxLength !== undefined && value.length > def.maxLength) return `must be at most ${def.maxLength} characters`;
      if (def.pattern && !new RegExp(def.pattern, def.patternFlags ?? '').test(value)) return def.patternMessage ?? 'is not in the right format';
      return true;
    },
  },
  number: {
    fallback: (def) => def.min ?? 0,
    coerce: (value) => (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value),
    check(value, def) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a number';
      if (def.integer && !Number.isInteger(value)) return 'must be a whole number';
      if (def.min !== undefined && value < def.min) return `must be at least ${def.min}`;
      if (def.max !== undefined && value > def.max) return `must be at most ${def.max}`;
      return true;
    },
  },
  select: {
    fallback: (def) => def.options[0].value,
    check(value, def) {
      if (def.multiple) {
        if (!Array.isArray(value)) return 'must be a list';
        return value.every((v) => def.options.some((o) => o.value === v)) || 'has a value that is not one of the options';
      }
      return def.options.some((o) => o.value === value) || 'must be one of the options';
    },
  },
  color: {
    fallback: () => '#000000',
    check: (value) => (typeof value === 'string' && COLOR.test(value)) || 'must be a hex colour like #7c5cff',
  },
  list: {
    fallback: () => [],
    check(value, def) {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) return 'must be a list of text';
      if (def.maxItems !== undefined && value.length > def.maxItems) return `can have at most ${def.maxItems} items`;
      return true;
    },
  },
  button: { stateless: true },
  custom: {
    fallback: () => null,
    check: () => true,
  },
};
SettingTypes.textarea = { ...SettingTypes.text };
SettingTypes.slider = { ...SettingTypes.number, fallback: (def) => def.min };
SettingTypes.boolean = SettingTypes.switch;
SettingTypes.string = SettingTypes.text;

/** Validates a settings schema and fills in what each definition leaves out. */
export function normalizeSchema(schema = {}, owner = '') {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) throw new ClientError(ErrorCodes.InvalidSetting, `${owner}: settings must be an object`);
  const out = {};
  let order = 0;
  for (const [key, raw] of Object.entries(schema)) {
    if (!KEY.test(key)) throw fail(owner, key, 'has an invalid name (letters, digits, _ and -)');
    const def = typeof raw === 'object' && raw !== null ? { ...raw } : null;
    if (!def) throw fail(owner, key, 'must be an object');
    def.type = def.type === 'boolean' ? 'switch' : def.type === 'string' ? 'text' : def.type;
    const type = SettingTypes[def.type];
    if (!type) throw fail(owner, key, `has an unknown type "${def.type}" (use ${Object.keys(SettingTypes).join(', ')})`);
    def.key = key;
    def.label = def.label ?? key;
    def.order = def.order ?? order++;
    if (def.type === 'select') def.options = normalizeOptions(def.options, owner, key);
    if (def.type === 'slider' && (def.min === undefined || def.max === undefined)) throw fail(owner, key, 'needs min and max');
    if (def.type === 'button' && typeof def.action !== 'function') throw fail(owner, key, 'needs an action function');
    if (def.type === 'custom' && typeof def.render !== 'function') throw fail(owner, key, 'needs a render function');
    if (!type.stateless) {
      if (def.default === undefined) def.default = type.fallback(def);
      const verdict = checkValue(def, def.default, null);
      if (verdict !== true) throw fail(owner, key, `has a default that ${verdict}`);
    }
    out[key] = def;
  }
  return out;
}

function checkValue(def, value, settings) {
  const type = SettingTypes[def.type];
  const base = type.check(value, def);
  if (base !== true) return base;
  if (typeof def.validate === 'function') {
    const verdict = def.validate(value, settings);
    if (verdict === false) return 'is not valid';
    if (typeof verdict === 'string') return verdict;
  }
  return true;
}

/**
 * A set of typed settings saved in a Store: plugin settings, theme options, the client's own.
 *
 *   settings.get('format')              // the saved value, or the default
 *   settings.set('format', '24h')       // validated; throws a ClientError with a readable message
 *   settings.onChange('format', fn)     // or '*' for every key
 */
export class Settings {
  #store;
  #listeners = new Map();
  #onError;

  constructor(schema, store, { owner = '', onError } = {}) {
    this.owner = owner;
    this.definitions = normalizeSchema(schema, owner);
    this.#store = store;
    this.#onError = onError ?? ((error) => console.error(error));
  }

  get(key) {
    const def = this.#definition(key);
    if (SettingTypes[def.type].stateless) return undefined;
    if (!this.#store.has(key)) return cloneDefault(def.default);
    const value = this.#store.get(key);
    return checkValue(def, value, this) === true ? value : cloneDefault(def.default);
  }

  all() {
    const out = {};
    for (const [key, def] of Object.entries(this.definitions)) if (!SettingTypes[def.type].stateless) out[key] = this.get(key);
    return out;
  }

  /** Validates `value` without saving it: true, or the reason it is rejected. */
  check(key, value) {
    const def = this.#definition(key);
    const coerced = SettingTypes[def.type].coerce ? SettingTypes[def.type].coerce(value, def) : value;
    return checkValue(def, coerced, this);
  }

  set(key, value) {
    const def = this.#definition(key);
    if (SettingTypes[def.type].stateless) throw fail(this.owner, key, 'has no value to set');
    const coerced = SettingTypes[def.type].coerce ? SettingTypes[def.type].coerce(value, def) : value;
    const verdict = checkValue(def, coerced, this);
    if (verdict !== true) throw fail(this.owner, key, verdict);
    const old = this.get(key);
    if (JSON.stringify(old) === JSON.stringify(coerced)) return this;
    this.#store.set(key, coerced);
    this.#emit(key, coerced, old);
    return this;
  }

  reset(key) {
    const keys = key === undefined ? Object.keys(this.definitions) : [key];
    for (const k of keys) {
      const def = this.#definition(k);
      if (SettingTypes[def.type].stateless) continue;
      const old = this.get(k);
      this.#store.delete(k);
      const now = this.get(k);
      if (JSON.stringify(old) !== JSON.stringify(now)) this.#emit(k, now, old);
    }
    return this;
  }

  /** Whether a setting is shown and editable right now (`hidden` / `disabled` may be functions). */
  state(key) {
    const def = this.#definition(key);
    const evaluate = (flag) => {
      try {
        return typeof flag === 'function' ? Boolean(flag(this)) : Boolean(flag);
      } catch (error) {
        this.#onError(error);
        return false;
      }
    };
    return { hidden: evaluate(def.hidden), disabled: evaluate(def.disabled) };
  }

  onChange(key, fn) {
    if (typeof key === 'function') return this.onChange('*', key);
    let set = this.#listeners.get(key);
    if (!set) this.#listeners.set(key, (set = new Set()));
    const entry = { fn };
    set.add(entry);
    return () => set.delete(entry);
  }

  #definition(key) {
    const def = this.definitions[key];
    if (!def) throw fail(this.owner, key, "doesn't exist");
    return def;
  }

  #emit(key, value, old) {
    const def = this.definitions[key];
    const run = (fn) => {
      try {
        fn(value, old, key);
      } catch (error) {
        this.#onError(error);
      }
    };
    if (typeof def.onChange === 'function') run(def.onChange.bind(def));
    for (const { fn } of [...(this.#listeners.get(key) ?? [])]) run(fn);
    for (const { fn } of [...(this.#listeners.get('*') ?? [])]) run(fn);
  }
}

function cloneDefault(value) {
  return value !== null && typeof value === 'object' ? cloneJSON(value) : value;
}
