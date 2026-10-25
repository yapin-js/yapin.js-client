import { ClientError, ErrorCodes } from './errors.js';
import { h } from './ui.js';
import { idPattern } from '../shared/constants.js';

const PAGE_ATTR = 'ycPage';

/**
 * Pages in Yapin’s user settings. A page is an id, a title and a render function:
 *
 *   client.pages.add({
 *     id: 'changelog',
 *     title: 'Changelog',
 *     render(root, ctx) {
 *       root.append(ctx.ui.heading('Changelog'), ctx.ui.hint('What changed'));
 *       return () => {};   // optional cleanup when the page closes
 *     },
 *   });
 *
 * Pages sit in sections (nav labels). The default section is labelled with the client app's name.
 * The framework draws the nav entries and swaps its own `section.settings-main` in for Yapin’s while one
 * of its pages is open, so Yapin’s React tree is never touched.
 */
export class PageManager {
  #pages = new Map();
  #sections = new Map();
  #navs = new Set();
  #pending = null;

  constructor(client, { section = {}, position = 'end' } = {}) {
    this.client = client;
    this.position = position;
    this.#sections.set('main', { id: 'main', label: section.label ?? client.name, order: section.order ?? 0 });
  }

  /** Adds or renames a section: `pages.section('tools', { label: 'Tools', order: 1 })`. */
  section(id, { label, order } = {}) {
    const existing = this.#sections.get(id);
    this.#sections.set(id, { id, label: label ?? existing?.label ?? id, order: order ?? existing?.order ?? this.#sections.size });
    this.#refresh();
    return this;
  }

  removeSection(id) {
    if (id === 'main') throw new ClientError(ErrorCodes.NotAllowed, 'The main section can be renamed but not removed');
    for (const page of this.#pages.values()) if (page.section === id) page.section = 'main';
    this.#sections.delete(id);
    this.#refresh();
  }

  sections() {
    return [...this.#sections.values()].sort((a, b) => a.order - b.order);
  }

  /** Adds a page. Returns a handle with update() and remove(). */
  add(definition, { owner = null } = {}) {
    const page = this.#normalize(definition);
    if (this.#pages.has(page.id)) throw new ClientError(ErrorCodes.DuplicateId, `A page with id "${page.id}" already exists`);
    page.owner = owner;
    this.#pages.set(page.id, page);
    this.#refresh();
    this.client.events.emit('page:add', page.id);
    return this.#handle(page.id);
  }

  get(id) {
    return this.#pages.has(id) ? this.#handle(id) : null;
  }

  has(id) {
    return this.#pages.has(id);
  }

  list() {
    return [...this.#pages.values()].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)).map((p) => ({ id: p.id, title: p.title, section: p.section, order: p.order, owner: p.owner }));
  }

  /** Changes a page's title, icon, order, section, render… The nav updates right away. */
  update(id, changes) {
    const page = this.#require(id);
    const next = this.#normalize({ ...page, ...changes, id });
    Object.assign(page, next);
    this.#refresh();
    for (const nav of this.#navs) if (nav.open === id) this.#show(nav, id);
    return this.#handle(id);
  }

  remove(id) {
    const page = this.#pages.get(id);
    if (!page) return false;
    for (const nav of this.#navs) if (nav.open === id) this.#close(nav, { restore: true });
    this.#pages.delete(id);
    this.#refresh();
    this.client.events.emit('page:remove', id);
    return true;
  }

  removeOwned(owner) {
    for (const page of [...this.#pages.values()]) if (page.owner === owner) this.remove(page.id);
  }

  /**
   * Opens a page. If user settings is open, it switches to the page; otherwise the page opens the
   * next time settings does (with `openSettings: true`, the framework clicks Yapin’s settings button).
   */
  open(id, { openSettings = true } = {}) {
    this.#require(id);
    const nav = [...this.#navs][0];
    if (nav) {
      this.#show(nav, id);
      return true;
    }
    this.#pending = id;
    if (openSettings) {
      const button = globalThis.document?.querySelector(this.client.host.selectors.settingsButton);
      button?.click();
    }
    return false;
  }

  /** Starts drawing pages into the settings menu. Called by the client once the page has a body. */
  start() {
    const { selectors } = this.client.host;
    return this.client.dom.observe(selectors.settingsNav, (navElement) => {
      if (!this.client.host.isUserSettings(navElement)) return undefined;
      return this.#attach(navElement);
    });
  }

  #normalize(def) {
    if (!def || typeof def !== 'object') throw new ClientError(ErrorCodes.InvalidDefinition, 'A page needs a definition object');
    if (!idPattern.test(def.id ?? '')) throw new ClientError(ErrorCodes.InvalidDefinition, `Page id "${def.id}" must be lowercase letters, digits and dashes`);
    if (typeof def.render !== 'function') throw new ClientError(ErrorCodes.InvalidDefinition, `Page "${def.id}" needs a render(root, ctx) function`);
    const section = def.section ?? 'main';
    if (!this.#sections.has(section)) this.#sections.set(section, { id: section, label: section, order: this.#sections.size });
    return {
      id: def.id,
      title: String(def.title ?? def.id),
      section,
      order: Number(def.order ?? 0),
      icon: def.icon ?? null,
      badge: def.badge ?? null,
      visible: def.visible ?? null,
      render: def.render,
      owner: def.owner ?? null,
    };
  }

  #require(id) {
    const page = this.#pages.get(id);
    if (!page) throw new ClientError(ErrorCodes.NotFound, `No page "${id}"`);
    return page;
  }

  #handle(id) {
    return {
      id,
      update: (changes) => this.update(id, changes),
      remove: () => this.remove(id),
      open: (options) => this.open(id, options),
    };
  }

  #isVisible(page) {
    if (typeof page.visible !== 'function') return page.visible !== false;
    try {
      return Boolean(page.visible(this.client));
    } catch (error) {
      this.client.reportError(error, { page: page.id });
      return false;
    }
  }

  #attach(element) {
    const nav = { element, wrapper: null, items: new Map(), open: null, section: null, cleanup: null, previousActive: null };
    const { classes } = this.client.host;
    const onHostClick = (event) => {
      const button = event.target.closest?.('button');
      if (!button || !element.contains(button) || nav.wrapper?.contains(button)) return;
      if (!nav.open) return;
      const restore = button === nav.previousActive;
      this.#close(nav, { restore: false });
      if (restore) button.classList.add(classes.navActive);
    };
    element.addEventListener('click', onHostClick, true);
    nav.render = () => this.#renderNav(nav);
    this.#navs.add(nav);
    nav.render();
    if (this.#pending && this.#pages.has(this.#pending)) {
      const id = this.#pending;
      this.#pending = null;
      this.#show(nav, id);
    }
    this.client.events.emit('settings:open', element);
    return () => {
      element.removeEventListener('click', onHostClick, true);
      this.#close(nav, { restore: false });
      nav.wrapper?.remove();
      this.#navs.delete(nav);
      this.client.events.emit('settings:close');
    };
  }

  #refresh() {
    for (const nav of this.#navs) nav.render();
  }

  #renderNav(nav) {
    const { classes, selectors } = this.client.host;
    const pages = [...this.#pages.values()].filter((p) => this.#isVisible(p));
    const groups = this.sections()
      .map((section) => ({ section, pages: pages.filter((p) => p.section === section.id).sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)) }))
      .filter((g) => g.pages.length);
    const wrapper = h('div', { class: 'yc-nav', style: { display: 'contents' }, dataset: { ycNav: this.client.id } });
    nav.items.clear();
    for (const { section, pages: list } of groups) {
      if (section.label) wrapper.appendChild(h('div', { class: classes.navLabel, style: { marginTop: '14px' } }, section.label));
      for (const page of list) {
        const button = h(
          'button',
          {
            type: 'button',
            class: { [classes.navActive]: nav.open === page.id, 'yc-nav-item': true },
            dataset: { ycPageId: page.id },
            onClick: () => this.#show(nav, page.id),
          },
          page.icon && this.client.ui.icon(page.icon),
          ` ${page.title}`,
          page.badge && h('span', { class: classes.newBadge ?? 'new-badge' }, String(page.badge)),
        );
        nav.items.set(page.id, button);
        wrapper.appendChild(button);
      }
    }
    if (nav.wrapper) nav.wrapper.replaceWith(wrapper);
    else this.#insert(nav.element, wrapper, selectors);
    nav.wrapper = wrapper;
    if (nav.open && !this.#pages.has(nav.open)) this.#close(nav, { restore: true });
  }

  #insert(navElement, wrapper, selectors) {
    const position = String(this.position ?? 'end');
    const labels = [...navElement.querySelectorAll(selectors.settingsNavLabel)].filter((l) => !l.closest('[data-yc-nav]'));
    const match = /^(before|after):(.+)$/i.exec(position);
    if (position === 'start') {
      navElement.insertBefore(wrapper, navElement.firstChild);
      return;
    }
    if (match) {
      const label = labels.find((l) => l.textContent.trim().toLowerCase() === match[2].trim().toLowerCase());
      if (label) {
        if (match[1].toLowerCase() === 'before') {
          label.parentNode.insertBefore(wrapper, label);
        } else {
          const next = labels[labels.indexOf(label) + 1];
          if (next) next.parentNode.insertBefore(wrapper, next);
          else navElement.appendChild(wrapper);
        }
        return;
      }
    }
    navElement.appendChild(wrapper);
  }

  #hostMain(nav) {
    const root = nav.element.closest(this.client.host.selectors.settingsRoot) ?? nav.element.parentElement;
    return [...root.querySelectorAll(this.client.host.selectors.settingsMain)].find((el) => !el.dataset[PAGE_ATTR]) ?? null;
  }

  #show(nav, id) {
    const page = this.#require(id);
    const { classes } = this.client.host;
    this.#close(nav, { restore: false, keepSection: true });
    const hostMain = this.#hostMain(nav);
    if (!nav.section) {
      nav.section = h('section', { class: classes.settingsMain, dataset: { [PAGE_ATTR]: this.client.id } });
      if (hostMain) hostMain.after(nav.section);
      else nav.element.after(nav.section);
    }
    if (hostMain) hostMain.style.display = 'none';
    nav.section.style.display = '';
    const hostButtons = [...nav.element.querySelectorAll('button')].filter((b) => !nav.wrapper?.contains(b));
    const active = hostButtons.find((b) => b.classList.contains(classes.navActive));
    if (active) {
      nav.previousActive = active;
      active.classList.remove(classes.navActive);
    }
    for (const [pageId, button] of nav.items) button.classList.toggle(classes.navActive, pageId === id);
    nav.open = id;
    const root = h('div', { class: 'yc-page', dataset: { ycPageId: id } });
    nav.section.replaceChildren(root);
    const disposers = [];
    const ctx = {
      client: this.client,
      ui: this.client.ui,
      h,
      page: this.#handle(id),
      onDispose: (fn) => disposers.push(fn),
      close: () => this.#close(nav, { restore: true }),
    };
    try {
      const cleanup = page.render(root, ctx);
      if (typeof cleanup === 'function') disposers.push(cleanup);
    } catch (error) {
      this.client.reportError(error, { page: id });
      root.replaceChildren(this.client.ui.heading(page.title), this.client.ui.hint(`This page failed to load: ${error?.message ?? error}`));
    }
    nav.cleanup = () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose();
        } catch (error) {
          this.client.reportError(error, { page: id });
        }
      }
    };
    this.client.events.emit('page:open', id);
  }

  #close(nav, { restore, keepSection = false }) {
    if (!nav.open && !nav.section) return;
    const id = nav.open;
    nav.cleanup?.();
    nav.cleanup = null;
    nav.open = null;
    for (const button of nav.items.values()) button.classList.remove(this.client.host.classes.navActive);
    if (!keepSection) {
      nav.section?.remove();
      nav.section = null;
      const hostMain = this.#hostMain(nav);
      if (hostMain) hostMain.style.display = '';
      if (restore && nav.previousActive?.isConnected) nav.previousActive.classList.add(this.client.host.classes.navActive);
      nav.previousActive = null;
    }
    if (id) this.client.events.emit('page:close', id);
  }
}
