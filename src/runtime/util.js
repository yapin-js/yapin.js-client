export const noop = () => {};

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Merges plain objects recursively; arrays and everything else from `override` replace. */
export function deepMerge(base, override) {
  if (override === undefined) return base;
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) out[key] = deepMerge(base[key], value);
  return out;
}

const UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** '30s', '15m', '2h', '1d' or a number of milliseconds. */
export function parseDuration(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const match = typeof value === 'string' && /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)\s*$/.exec(value);
  return match ? Number(match[1]) * UNITS[match[2]] : fallback;
}

/** Delays fn until calls stop for `ms`. flush() runs a pending call now (with new args, if given). */
export function debounce(fn, ms) {
  let timer = null;
  let pending = [];
  const debounced = (...args) => {
    pending = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...pending);
    }, ms);
  };
  debounced.flush = (...args) => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    fn(...(args.length ? args : pending));
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

/** Compares dotted versions ('1.2.10' > '1.2.9'). Pre-release suffixes sort before the release. */
export function compareVersions(a, b) {
  const parse = (v) => {
    const [core, pre = null] = String(v ?? '0').replace(/^v/, '').split('-', 2);
    return { parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const diff = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * Parses a URL and returns it only if its protocol is allowed. Everything the framework puts in an
 * href or src goes through here, so `javascript:` and friends never reach the page.
 */
export function safeURL(value, { protocols = ['https:'], base } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    return protocols.includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

/** A deep copy of a JSON value. Throws on anything that doesn't survive JSON. */
export function cloneJSON(value, label = 'value') {
  if (value === undefined) throw new TypeError(`${label} can't be undefined`);
  const text = JSON.stringify(value);
  if (text === undefined) throw new TypeError(`${label} must be JSON (no functions or symbols)`);
  return JSON.parse(text);
}

export function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) freezeDeep(inner);
  }
  return value;
}

export function toArray(value) {
  return value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
}

let counter = 0;
export function uid(prefix = 'yc') {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Sorts definitions so each comes after the ones it depends on. Unknown or circular ones are reported. */
export function sortByDependencies(items, { id = (x) => x.id, deps = (x) => x.dependencies ?? [] } = {}) {
  const byId = new Map(items.map((item) => [id(item), item]));
  const sorted = [];
  const problems = [];
  const state = new Map();
  const visit = (item, trail) => {
    const key = id(item);
    if (state.get(key) === 'done') return true;
    if (state.get(key) === 'visiting') {
      problems.push({ id: key, reason: `circular dependency: ${[...trail, key].join(' → ')}` });
      return false;
    }
    state.set(key, 'visiting');
    for (const dep of deps(item)) {
      const target = byId.get(dep);
      if (!target) {
        problems.push({ id: key, reason: `needs "${dep}", which isn't available` });
        state.set(key, 'done');
        return false;
      }
      if (!visit(target, [...trail, key])) {
        state.set(key, 'done');
        return false;
      }
    }
    state.set(key, 'done');
    sorted.push(item);
    return true;
  };
  for (const item of items) visit(item, []);
  return { sorted, problems };
}
