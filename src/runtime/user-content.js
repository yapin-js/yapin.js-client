import { ClientError, ErrorCodes, tagError } from './errors.js';
import { idFromFile, parseMeta } from './meta.js';
import { h } from './ui.js';
import { idPattern } from '../shared/constants.js';

const KINDS = {
  plugins: { ext: '.plugin.js', pattern: /\.m?js$/i, label: 'plugin' },
  themes: { ext: '.theme.css', pattern: /\.css$/i, label: 'theme' },
};

/**
 * Plugins and themes the person using the client installs themselves. On desktop they're files in the
 * client app's data folder (edit one and it reloads); in a browser they're saved in localStorage.
 * Nothing runs before the person has seen what it is and agreed.
 */
export class UserContent {
  constructor(client, config = {}) {
    this.client = client;
    this.config = config;
    this.webStores = {
      plugins: client.storage.namespace('user.plugins'),
      themes: client.storage.namespace('user.themes'),
    };
  }

  #kindConfig(kind) {
    return this.config[kind]?.user ?? {};
  }

  /** Whether people may add their own plugins / themes at all. */
  allowed(kind) {
    return this.#kindConfig(kind).enabled !== false;
  }

  /** Whether they may install from a link (and not only by dropping files in the folder). */
  canInstallFromURL(kind) {
    return this.allowed(kind) && this.#kindConfig(kind).install?.url !== false;
  }

  /** Loads what's installed. `files` is the desktop snapshot: [{ file, source }]. */
  async loadAll(kind, files) {
    if (!this.allowed(kind)) return;
    const entries = this.client.native ? files ?? [] : Object.values(this.webStores[kind].all());
    for (const entry of entries) {
      try {
        await this.#register(kind, entry.source, entry.file);
      } catch (error) {
        this.client.reportError(tagError(error, { where: `user ${KINDS[kind].label} ${entry.file}` }));
      }
    }
  }

  async #register(kind, text, file) {
    if (kind === 'plugins') return this.client.plugins.addSource(text, { file, source: 'user' });
    const theme = this.client.themes.parse(text, { file, source: 'user' });
    return this.client.themes.add(theme, { source: 'user', file });
  }

  /**
   * Installs from a link or from text. Shows the person what they're installing and asks first.
   * Resolves with the id, or null if they said no.
   */
  async install(kind, { url = null, text = null, file = null, confirm = true } = {}) {
    if (!KINDS[kind]) throw new TypeError(`Unknown kind "${kind}"`);
    if (!this.allowed(kind)) throw new ClientError(ErrorCodes.NotAllowed, `${this.client.name} doesn't allow installing ${kind}`);
    if (url && !this.canInstallFromURL(kind)) throw new ClientError(ErrorCodes.NotAllowed, `${this.client.name} doesn't allow installing ${kind} from links`);
    const install = this.#kindConfig(kind).install ?? {};
    const maxBytes = install.maxBytes ?? (kind === 'plugins' ? 1_000_000 : 2_000_000);
    if (url) text = await this.client.api.download(url, { maxBytes, allowedHosts: install.allowedHosts ?? [] });
    if (typeof text !== 'string' || !text.trim()) throw new ClientError(ErrorCodes.LoadFailed, 'Nothing to install');
    if (text.length > maxBytes) throw new ClientError(ErrorCodes.LoadFailed, `That ${KINDS[kind].label} is too large`);
    const { meta } = parseMeta(text);
    const id = meta.id ?? (file ? idFromFile(file) : url ? idFromFile(new URL(url).pathname) : null);
    if (!id || !idPattern.test(id)) throw new ClientError(ErrorCodes.InvalidDefinition, `The ${KINDS[kind].label} needs an @id in its header`);
    const manager = kind === 'plugins' ? this.client.plugins : this.client.themes;
    const existing = manager.has(id) ? (kind === 'plugins' ? manager.info(id) : manager.list().find((t) => t.id === id)) : null;
    if (existing && existing.source !== 'user') throw new ClientError(ErrorCodes.DuplicateId, `"${id}" is already part of ${this.client.name}`);
    if (confirm && !(await this.#confirm(kind, { meta, id, url, existing, size: text.length }))) return null;
    const fileName = `${id}${KINDS[kind].ext}`;
    await this.#register(kind, text, fileName);
    if (this.client.native) await this.client.native.write(kind, fileName, text);
    else this.webStores[kind].set(id, { file: fileName, source: text, url, installedAt: new Date().toISOString() });
    this.client.events.emit(`${kind === 'plugins' ? 'plugin' : 'theme'}:install`, id);
    return id;
  }

  async #confirm(kind, { meta, id, url, existing, size }) {
    const { ui } = this.client;
    const label = KINDS[kind].label;
    const rows = [
      { label: 'Name', value: meta.name ?? id },
      meta.version && { label: 'Version', value: meta.version },
      meta.authors?.length && { label: 'By', value: meta.authors.map((a) => a.name).join(', ') },
      meta.description && { label: 'About', value: meta.description },
      url && { label: 'From', value: url },
      { label: 'Size', value: `${Math.max(1, Math.round(size / 1000))} kB` },
    ].filter(Boolean);
    const warning =
      kind === 'plugins'
        ? 'Plugins run with full access to Yapin’ in this window, including your account. Only install plugins from people you trust.'
        : 'Themes only change how Yapin’ looks, but they can load images from other websites.';
    return ui.confirm({
      title: existing ? `Update ${label} "${meta.name ?? id}"?` : `Install ${label} "${meta.name ?? id}"?`,
      content: h('div', null, ui.keyValue(rows), ui.hint(warning)),
      confirmLabel: existing ? 'Update' : 'Install',
      danger: kind === 'plugins',
    });
  }

  /** Removes an installed plugin or theme, with its saved settings. */
  async uninstall(kind, id) {
    const manager = kind === 'plugins' ? this.client.plugins : this.client.themes;
    const info = kind === 'plugins' ? manager.info(id) : manager.list().find((t) => t.id === id);
    if (!info) throw new ClientError(ErrorCodes.NotFound, `No ${KINDS[kind].label} "${id}"`);
    if (info.source !== 'user') throw new ClientError(ErrorCodes.NotAllowed, `"${id}" is part of ${this.client.name} and can't be uninstalled`);
    manager.remove(id);
    if (this.client.native) await this.client.native.remove(kind, info.file);
    else this.webStores[kind].delete(id);
    this.client.events.emit(`${kind === 'plugins' ? 'plugin' : 'theme'}:uninstall`, id);
    return true;
  }

  /** Desktop: a file in the plugins/themes folder changed. Reloads (or removes) what it defines. */
  async fileChanged(kind, file, text) {
    if (!KINDS[kind] || !KINDS[kind].pattern.test(file) || !this.allowed(kind)) return;
    const manager = kind === 'plugins' ? this.client.plugins : this.client.themes;
    const current = (kind === 'plugins' ? manager.list({ includeHidden: true }) : manager.list()).find((x) => x.file === file && x.source === 'user');
    if (text === null) {
      if (current) manager.remove(current.id);
      return;
    }
    const wasRunning = current && (kind === 'plugins' ? manager.isRunning(current.id) : current.enabled);
    if (current) manager.remove(current.id);
    try {
      await this.#register(kind, text, file);
      const { meta } = parseMeta(text);
      const id = meta.id ?? current?.id ?? idFromFile(file);
      if (kind === 'plugins' && (wasRunning || this.client.plugins.isEnabled(id)) && this.client.plugins.has(id)) await this.client.plugins.start(id);
      this.client.logger.info(`reloaded ${file}`);
    } catch (error) {
      this.client.reportError(tagError(error, { where: `reload ${file}` }));
      this.client.ui.toast(`${file} has an error: ${error.message}`, { type: 'error', timeout: 8000 });
    }
  }

  openFolder(kind) {
    return this.client.native?.openFolder(kind);
  }
}
