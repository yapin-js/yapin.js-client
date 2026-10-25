const STATE = Symbol.for('yapin-client.patch');

/**
 * Wraps methods on objects you don't own. Any number of patches can sit on one method and be removed
 * in any order; when the last one goes, the original method is put back. A patch that throws is
 * reported and skipped, so the method keeps working.
 *
 *   const unpatch = patcher.after(obj, 'render', (args, result) => result, { owner: 'my-plugin' });
 *
 * - before(args, thisArg): change `args` in place, or return a new array to replace them.
 * - instead(args, original, thisArg): call `original(...args)` yourself (or don't). Return the result.
 * - after(args, result, thisArg): return something other than undefined to replace the result.
 */
export class Patcher {
  #onError;
  #byOwner = new Map();

  constructor({ onError } = {}) {
    this.#onError = onError ?? ((error) => console.error(error));
  }

  before(target, key, fn, options) {
    return this.#add(target, key, 'before', fn, options);
  }

  instead(target, key, fn, options) {
    return this.#add(target, key, 'instead', fn, options);
  }

  after(target, key, fn, options) {
    return this.#add(target, key, 'after', fn, options);
  }

  /** Removes every patch made with `{ owner }`. */
  unpatchAll(owner) {
    const list = this.#byOwner.get(owner);
    if (!list) return 0;
    this.#byOwner.delete(owner);
    for (const unpatch of [...list]) unpatch();
    return list.size;
  }

  /** True if `target[key]` is currently wrapped by this framework. */
  static isPatched(target, key) {
    return Boolean(target?.[key]?.[STATE]);
  }

  #add(target, key, type, fn, { owner = null } = {}) {
    if (target === null || (typeof target !== 'object' && typeof target !== 'function')) throw new TypeError(`Can't patch ${key} on ${target}`);
    if (typeof fn !== 'function') throw new TypeError('A patch must be a function');
    let wrapper = target[key];
    if (typeof wrapper !== 'function') throw new TypeError(`${String(key)} is not a function`);
    if (!wrapper[STATE] || wrapper[STATE].target !== target) wrapper = this.#wrap(target, key);
    const state = wrapper[STATE];
    const patch = { type, fn, owner };
    state.patches.push(patch);
    let removed = false;
    const unpatch = () => {
      if (removed) return;
      removed = true;
      state.patches = state.patches.filter((p) => p !== patch);
      if (owner !== null) this.#byOwner.get(owner)?.delete(unpatch);
      if (state.patches.length === 0 && target[key] === wrapper) {
        const descriptor = state.descriptor;
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else delete target[key];
      }
    };
    if (owner !== null) {
      if (!this.#byOwner.has(owner)) this.#byOwner.set(owner, new Set());
      this.#byOwner.get(owner).add(unpatch);
    }
    return unpatch;
  }

  #wrap(target, key) {
    const original = target[key];
    const own = Object.getOwnPropertyDescriptor(target, key);
    const report = this.#onError;
    const state = { target, original, patches: [], descriptor: own ?? null };
    const wrapper = function (...args) {
      let callArgs = args;
      const patches = state.patches;
      for (const p of patches) {
        if (p.type !== 'before') continue;
        try {
          const replaced = p.fn.call(this, callArgs, this);
          if (Array.isArray(replaced)) callArgs = replaced;
        } catch (error) {
          report(error, p.owner);
        }
      }
      const insteads = patches.filter((p) => p.type === 'instead');
      const self = this;
      const callAt = (index, currentArgs) => {
        if (index < 0) return new.target ? Reflect.construct(original, currentArgs, new.target) : original.apply(self, currentArgs);
        const p = insteads[index];
        try {
          return p.fn.call(self, currentArgs, (...next) => callAt(index - 1, next), self);
        } catch (error) {
          report(error, p.owner);
          return callAt(index - 1, currentArgs);
        }
      };
      let result = callAt(insteads.length - 1, callArgs);
      for (const p of patches) {
        if (p.type !== 'after') continue;
        try {
          const replaced = p.fn.call(this, callArgs, result, this);
          if (replaced !== undefined) result = replaced;
        } catch (error) {
          report(error, p.owner);
        }
      }
      return result;
    };
    Object.defineProperties(wrapper, {
      name: { value: original.name },
      length: { value: original.length },
      toString: { value: () => Function.prototype.toString.call(original), configurable: true },
    });
    Object.defineProperty(wrapper, STATE, { value: state });
    for (const prop of Object.getOwnPropertyNames(original)) {
      if (!(prop in wrapper)) {
        try {
          Object.defineProperty(wrapper, prop, Object.getOwnPropertyDescriptor(original, prop));
        } catch {
          // non-configurable; skip
        }
      }
    }
    if (original.prototype) wrapper.prototype = original.prototype;
    Object.defineProperty(target, key, { value: wrapper, writable: true, configurable: true, enumerable: own?.enumerable ?? false });
    return wrapper;
  }
}
