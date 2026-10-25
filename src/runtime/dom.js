/**
 * Watching the page. One MutationObserver serves every watcher; each watcher gets called once per
 * matching element as it appears, and the cleanup it returned runs when that element leaves the page.
 */
export class DomWatcher {
  #watchers = new Set();
  #observer = null;
  #pending = false;
  #onError;

  constructor({ onError, root } = {}) {
    this.#onError = onError ?? ((error) => console.error(error));
    this.root = root ?? globalThis.document;
  }

  get available() {
    return Boolean(this.root && typeof MutationObserver === 'function');
  }

  /**
   * Calls `onMatch(element)` for every element matching `selector`, now and as they appear.
   * `onMatch` may return a cleanup function, called when the element is removed or the watcher stops.
   * Returns a function that stops watching (and runs the pending cleanups).
   */
  observe(selector, onMatch, { filter } = {}) {
    if (!this.available) return () => {};
    const watcher = { selector, onMatch, filter, seen: new Map() };
    this.#watchers.add(watcher);
    this.#start();
    this.#scan(watcher, this.root);
    return () => {
      if (!this.#watchers.delete(watcher)) return;
      for (const cleanup of watcher.seen.values()) this.#run(cleanup);
      watcher.seen.clear();
      if (this.#watchers.size === 0) this.#stop();
    };
  }

  /** Resolves with the first element matching `selector` (null after `timeout` ms, if given). */
  waitFor(selector, { timeout = 0 } = {}) {
    return new Promise((resolve) => {
      let timer = null;
      let stop = null;
      let done = false;
      const finish = (element) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        queueMicrotask(() => stop?.());
        resolve(element);
      };
      stop = this.observe(selector, (element) => finish(element));
      if (done) stop();
      else if (timeout > 0) timer = setTimeout(() => finish(null), timeout);
    });
  }

  #start() {
    if (this.#observer) return;
    this.#observer = new MutationObserver(() => this.#schedule());
    this.#observer.observe(this.root.documentElement ?? this.root, { childList: true, subtree: true });
  }

  #stop() {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  #schedule() {
    if (this.#pending) return;
    this.#pending = true;
    queueMicrotask(() => {
      this.#pending = false;
      for (const watcher of [...this.#watchers]) {
        for (const [element, cleanup] of watcher.seen) {
          if (!element.isConnected) {
            watcher.seen.delete(element);
            this.#run(cleanup);
          }
        }
        this.#scan(watcher, this.root);
      }
    });
  }

  #scan(watcher, root) {
    let found;
    try {
      found = root.querySelectorAll(watcher.selector);
    } catch (error) {
      this.#onError(new Error(`Invalid selector "${watcher.selector}": ${error.message}`));
      this.#watchers.delete(watcher);
      return;
    }
    for (const element of found) {
      if (watcher.seen.has(element) || !this.#watchers.has(watcher)) continue;
      if (watcher.filter && !watcher.filter(element)) continue;
      watcher.seen.set(element, null);
      try {
        const cleanup = watcher.onMatch(element);
        if (typeof cleanup === 'function') watcher.seen.set(element, cleanup);
      } catch (error) {
        this.#onError(error);
      }
    }
  }

  #run(cleanup) {
    if (typeof cleanup !== 'function') return;
    try {
      cleanup();
    } catch (error) {
      this.#onError(error);
    }
  }
}

/** Resolves once document.body exists. */
export function bodyReady(doc = globalThis.document) {
  if (!doc) return Promise.resolve(null);
  if (doc.body) return Promise.resolve(doc.body);
  return new Promise((resolve) => {
    const check = () => {
      if (!doc.body) return;
      observer.disconnect();
      resolve(doc.body);
    };
    const observer = new MutationObserver(check);
    observer.observe(doc.documentElement ?? doc, { childList: true, subtree: true });
    doc.addEventListener('DOMContentLoaded', check, { once: true });
  });
}

/**
 * Stylesheets added with adoptedStyleSheets: they come after the page's own CSS in the cascade, they
 * aren't elements React could remove, and a Content-Security-Policy doesn't block them.
 * Falls back to <style> elements where constructable stylesheets aren't available.
 */
export class StyleManager {
  #sheets = [];
  #doc;

  constructor(doc = globalThis.document) {
    this.#doc = doc;
    this.constructable = Boolean(doc && 'adoptedStyleSheets' in doc && typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype);
  }

  /** Adds CSS; returns { update(css), remove(), id }. Order: lower `order` first, so later ones win. */
  add(css, { id = '', order = 0 } = {}) {
    const entry = { id, order, css: String(css ?? ''), sheet: null, element: null, removed: false };
    if (!this.#doc) return this.#handle(entry);
    if (this.constructable) {
      entry.sheet = new CSSStyleSheet();
      this.#replace(entry);
    } else {
      entry.element = this.#doc.createElement('style');
      entry.element.dataset.ycStyle = id;
      entry.element.textContent = entry.css;
    }
    this.#sheets.push(entry);
    this.#sheets.sort((a, b) => a.order - b.order);
    this.#apply();
    return this.#handle(entry);
  }

  #replace(entry) {
    try {
      entry.sheet.replaceSync(entry.css);
      entry.error = null;
    } catch (error) {
      entry.error = error;
    }
  }

  #handle(entry) {
    return {
      id: entry.id,
      get error() {
        return entry.error ?? null;
      },
      update: (css) => {
        if (entry.removed) return;
        entry.css = String(css ?? '');
        if (entry.sheet) this.#replace(entry);
        if (entry.element) entry.element.textContent = entry.css;
      },
      remove: () => {
        if (entry.removed) return;
        entry.removed = true;
        this.#sheets = this.#sheets.filter((e) => e !== entry);
        entry.element?.remove();
        this.#apply();
      },
    };
  }

  #apply() {
    if (!this.#doc) return;
    if (this.constructable) {
      const ours = new Set(this.#sheets.map((e) => e.sheet));
      const others = this.#doc.adoptedStyleSheets.filter((sheet) => !ours.has(sheet) && !sheet.__yc);
      for (const sheet of ours) sheet.__yc = true;
      this.#doc.adoptedStyleSheets = [...others, ...this.#sheets.map((e) => e.sheet)];
      return;
    }
    const parent = this.#doc.head ?? this.#doc.documentElement;
    for (const entry of this.#sheets) parent?.appendChild(entry.element);
  }
}
