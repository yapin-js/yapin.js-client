/**
 * A small event emitter for the page (no node:events there). Listener errors go to `onError` instead of
 * stopping the other listeners, and every `on` returns its own unsubscribe function.
 */
export class Emitter {
  #listeners = new Map();
  #onError;

  constructor({ onError } = {}) {
    this.#onError = onError ?? ((error) => console.error(error));
  }

  on(event, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    let set = this.#listeners.get(event);
    if (!set) this.#listeners.set(event, (set = new Set()));
    const entry = { listener };
    set.add(entry);
    return () => set.delete(entry);
  }

  once(event, listener) {
    const off = this.on(event, (...args) => {
      off();
      return listener(...args);
    });
    return off;
  }

  off(event, listener) {
    const set = this.#listeners.get(event);
    if (!set) return;
    for (const entry of set) if (entry.listener === listener) set.delete(entry);
  }

  emit(event, ...args) {
    const set = this.#listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const entry of [...set]) {
      try {
        const out = entry.listener(...args);
        if (out && typeof out.catch === 'function') out.catch((error) => this.#onError(error, event));
      } catch (error) {
        this.#onError(error, event);
      }
    }
    return true;
  }

  listenerCount(event) {
    return this.#listeners.get(event)?.size ?? 0;
  }

  /** Resolves with the event's arguments the next time it fires (and `filter` agrees). */
  wait(event, { timeout = 0, filter } = {}) {
    return new Promise((resolve, reject) => {
      let timer = null;
      const off = this.on(event, (...args) => {
        if (filter && !filter(...args)) return;
        off();
        clearTimeout(timer);
        resolve(args);
      });
      if (timeout > 0) {
        timer = setTimeout(() => {
          off();
          reject(new Error(`Timed out waiting for "${event}"`));
        }, timeout);
      }
    });
  }

  removeAll(event) {
    if (event === undefined) this.#listeners.clear();
    else this.#listeners.delete(event);
  }
}
