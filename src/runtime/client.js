import { AboutPage } from './about.js';
import { ApiClient, Secrets } from './api.js';
import { BadgeManager } from './badges.js';
import { pluginsPage, themesPage } from './builtin-pages.js';
import { tagError } from './errors.js';
import { Emitter } from './events.js';
import { Host } from './host.js';
import { Logger } from './logger.js';
import { ModuleFinder } from './modules.js';
import { Welcome, WhatsNew, onboardingCSS } from './onboarding.js';
import { PageManager } from './pages.js';
import { Patcher } from './patcher.js';
import { PluginManager } from './plugins.js';
import { fiberOf, findProps, findUserId, findValue, propsOf } from './react.js';
import { Settings } from './settings.js';
import { LocalStorageBackend, MemoryBackend, NativeBackend, StorageManager } from './storage.js';
import { DomWatcher, StyleManager, bodyReady } from './dom.js';
import { StyleOrder, ThemeManager } from './themes.js';
import { UI, baseCSS } from './ui.js';
import { UserContent } from './user-content.js';
import { freezeDeep, safeURL } from './util.js';

/**
 * One client app, running in the Yapin’ page. Created by the runtime at startup and handed to the
 * client app's entry file (`export default function setup(client) {}`) and to every plugin as
 * `ctx.client`.
 */
export class Client {
  #readyResolve;

  constructor({ manifest, native = null, snapshot = null, safeMode = false, environment = {}, hook = null, storageBackend, loadModule, fetch, win = globalThis.window } = {}) {
    this.manifest = freezeDeep(structuredClone(manifest ?? {}));
    const config = this.manifest.config ?? {};
    this.config = config;
    this.id = this.manifest.id ?? 'client';
    this.name = this.manifest.name ?? this.id;
    this.version = this.manifest.version ?? '0.0.0';
    this.native = native;
    this.safeMode = Boolean(safeMode);
    this.environment = Object.freeze({ ...environment });

    this.logger = new Logger({ name: this.id, level: config.runtime?.logLevel ?? (this.manifest.build?.mode === 'development' ? 'debug' : 'info'), color: config.runtime?.logColor });
    this.events = new Emitter({ onError: (error, event) => this.reportError(error, { where: `event ${event}` }) });
    const backend = storageBackend ?? (native ? new NativeBackend(native, snapshot?.storage ?? {}) : canUseLocalStorage() ? new LocalStorageBackend(`yc:${this.id}:`) : new MemoryBackend());
    this.storage = new StorageManager(backend, { onError: (error) => this.reportError(error) });
    this.host = new Host(config.host ?? {}, { win });
    this.dom = new DomWatcher({ onError: (error) => this.reportError(error, { where: 'dom' }) });
    this.styles = new StyleManager(win?.document);
    this.ui = new UI({ host: this.host, openExternal: (url) => this.openExternal(url), onError: (error) => this.reportError(error, { where: 'ui' }) });
    this.react = {
      fiberOf,
      propsOf,
      findProps,
      findValue,
      findUserId: (node, paths = this.host.config.userIdProps, options) => findUserId(node, paths, options),
    };
    this.modules = new ModuleFinder(hook);
    this.patcher = new Patcher({ onError: (error, owner) => this.reportError(tagError(error, { plugin: owner?.id, where: 'patch' })) });
    this.secrets = new Secrets({ native, store: native ? null : this.storage.namespace('secrets') });
    this.api = new ApiClient({ services: config.api?.services ?? {}, allowedOrigins: config.api?.allowedOrigins ?? [], native, fetch, secrets: this.secrets, logger: this.logger.child('api') });
    this.settings = new Settings(config.settings ?? {}, this.storage.namespace('client'), { owner: this.name, onError: (error) => this.reportError(error) });
    this.pages = new PageManager(this, { section: { label: config.pages?.section ?? this.name }, position: config.pages?.position ?? 'end' });
    this.themes = new ThemeManager(this, { ...config.themes, baseCSS: this.manifest.baseCSS ?? '' });
    this.plugins = new PluginManager(this, config.plugins ?? {}, { loadModule });
    this.badges = new BadgeManager(this, config.badges ?? {});
    this.userContent = new UserContent(this, { plugins: config.plugins ?? {}, themes: config.themes ?? {} });
    this.welcome = config.welcome === false ? null : new Welcome(this, config.welcome ?? {});
    this.whatsNew = config.whatsNew === false ? null : new WhatsNew(this, config.whatsNew ?? {});
    this.about = config.about === false ? null : new AboutPage(this, config.about ?? {});
    this.ready = new Promise((resolve) => {
      this.#readyResolve = resolve;
    });
    this.isReady = false;
  }

  /** Logs an error (tagged with where it came from) and emits 'error'. Never throws. */
  reportError(error, tags = {}) {
    const err = tagError(error, tags);
    const where = [err.plugin && `plugin ${err.plugin}`, err.theme && `theme ${err.theme}`, err.page && `page ${err.page}`, err.where].filter(Boolean).join(', ');
    try {
      this.logger.error(...(where ? [`[${where}]`] : []), err);
      if (this.events.listenerCount('error')) this.events.emit('error', err);
    } catch {
      // logging must never take the client down
    }
  }

  /** Opens an https link in the browser (desktop) or a new tab (web). */
  openExternal(url) {
    const parsed = safeURL(url, { protocols: ['https:', 'mailto:'] });
    if (!parsed) return false;
    if (this.native) this.native.openExternal(parsed.href);
    else globalThis.open?.(parsed.href, '_blank', 'noopener,noreferrer');
    return true;
  }

  /**
   * Starts everything: styles and themes first (so there's no flash of the plain app), then the client
   * app's own setup, then installed plugins and themes, then pages and badges once the page has a body,
   * and finally the plugins themselves.
   */
  async start(bundle = {}) {
    const config = this.config;
    this.styles.add(baseCSS, { id: 'framework', order: StyleOrder.framework });
    this.styles.add(onboardingCSS, { id: 'framework-onboarding', order: StyleOrder.framework });
    for (const theme of bundle.themes ?? []) {
      try {
        this.themes.add(this.themes.parse(theme.text, { file: theme.file, source: 'bundled' }), { source: 'bundled', file: theme.file });
      } catch (error) {
        this.reportError(error, { where: `bundled theme ${theme.file}` });
      }
    }
    this.themes.start();

    for (const definition of bundle.plugins ?? []) {
      try {
        this.plugins.add(definition, { source: 'bundled' });
      } catch (error) {
        this.reportError(error, { where: 'bundled plugin' });
      }
    }
    this.#addBuiltinPages();
    for (const source of config.badges?.sources ?? []) {
      try {
        this.badges.addProvider(source);
      } catch (error) {
        this.reportError(error, { where: `badge source ${source.id}` });
      }
    }

    const setup = bundle.entry?.default ?? bundle.entry?.setup;
    if (typeof setup === 'function') {
      try {
        await setup(this);
      } catch (error) {
        this.reportError(error, { where: 'client app setup' });
      }
    }

    await this.userContent.loadAll('themes', this.native ? bundle.snapshot?.userThemes : null);
    await this.userContent.loadAll('plugins', this.native ? bundle.snapshot?.userPlugins : null);
    this.native?.onFileChange?.((kind, file, text) => void this.userContent.fileChanged(kind, file, text));

    const win = this.host.window;
    win?.addEventListener?.('pagehide', () => this.storage.flushAll({ sync: true }));
    if (config.runtime?.exposeGlobal && win) win[config.runtime.exposeGlobal] = this;

    await bodyReady(win?.document);
    this.pages.start();
    this.badges.start();
    await this.plugins.startAll();
    if (this.safeMode) this.ui.toast(`${this.name} is in safe mode: plugins and themes are off.`, { type: 'warning', timeout: 8000 });
    this.#maybeShowOnboarding();
    this.isReady = true;
    this.#readyResolve(this);
    this.events.emit('ready', this);
    this.logger.info(`${this.name} ${this.version} ready${this.safeMode ? ' (safe mode)' : ''}`);
    return this;
  }

  #addBuiltinPages() {
    const pages = this.config.pages ?? {};
    if (this.about) {
      this.pages.add({ id: 'about', title: this.config.about?.title ?? 'About', order: this.config.about?.order ?? 0, icon: this.config.about?.icon ?? 'info', render: (root, ctx) => this.about.render(root, ctx) });
    }
    if (pages.plugins !== false) this.pages.add(pluginsPage(this, pages.plugins ?? {}));
    if (pages.themes !== false) this.pages.add(themesPage(this, pages.themes ?? {}));
    if (pages.settings !== false && Object.keys(this.settings.definitions).length) {
      const options = pages.settings ?? {};
      this.pages.add({
        id: 'settings',
        title: options.title ?? 'Settings',
        order: options.order ?? 5,
        icon: options.icon ?? 'sliders',
        render: (root, ctx) => {
          const form = this.ui.form(this.settings, { context: this });
          root.append(this.ui.heading(options.title ?? 'Settings'), form.element);
          ctx.onDispose(form.dispose);
        },
      });
    }
  }

  /** First run shows the welcome screen (and skips what's new for that first run); otherwise an update shows what's new. */
  #maybeShowOnboarding() {
    if (this.welcome?.shouldShow()) {
      this.welcome.show();
      this.whatsNew?.markSeen();
    } else {
      this.whatsNew?.maybeShow();
    }
  }

  /** Stops plugins, removes styles and flushes storage. Mostly for tests and development reloads. */
  stop() {
    this.plugins.stopAll();
    this.themes.stop();
    this.badges.stop();
    this.storage.flushAll();
  }
}

function canUseLocalStorage() {
  try {
    const key = '__yc_probe__';
    globalThis.localStorage.setItem(key, '1');
    globalThis.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
