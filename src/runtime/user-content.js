import { ClientError, ErrorCodes, tagError } from './errors.js';
import { idFromFile, parseMeta } from './meta.js';
import { listNames } from './security.js';
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

  /**
   * Whether they may install from a link (and not only by dropping files in the folder). Both the
   * client app and the person's own security settings have to allow it.
   */
  canInstallFromURL(kind) {
    return this.allowed(kind) && this.#kindConfig(kind).install?.url !== false && this.client.security.installFromLinks;
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
   * Installs from a link or from text. Shows the person what they're installing, who wrote it and
   * where it came from, and asks first — for a plugin, they have to say they trust its authors.
   * Resolves with the id, or null if they said no.
   */
  async install(kind, { url = null, text = null, file = null, confirm = true } = {}) {
    if (!KINDS[kind]) throw new TypeError(`Unknown kind "${kind}"`);
    if (!this.allowed(kind)) throw new ClientError(ErrorCodes.NotAllowed, `${this.client.name} doesn't allow installing ${kind}`);
    if (url && this.#kindConfig(kind).install?.url === false) throw new ClientError(ErrorCodes.NotAllowed, `${this.client.name} doesn't allow installing ${kind} from links`);
    if (url && !this.client.security.installFromLinks) throw new ClientError(ErrorCodes.NotAllowed, 'Installing from links is turned off in your security settings');
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
    const { security } = this.client;
    let remember = false;
    if (confirm && security.shouldConfirm(kind)) {
      const answer = await this.#ask(kind, { meta, id, url, existing, size: text.length });
      if (!answer.installed) return null;
      remember = answer.remember;
    }
    const fileName = `${id}${KINDS[kind].ext}`;
    await this.#register(kind, text, fileName);
    if (this.client.native) await this.client.native.write(kind, fileName, text);
    else this.webStores[kind].set(id, { file: fileName, source: text, url, installedAt: new Date().toISOString() });
    if (remember) security.trustAuthors(meta.authors ?? []);
    security.recordInstall(kind, id, { url, authors: meta.authors ?? [], name: meta.name ?? id, trustedAuthors: security.trustsAuthors(meta.authors ?? []) });
    this.client.events.emit(`${kind === 'plugins' ? 'plugin' : 'theme'}:install`, id);
    return id;
  }

  /**
   * The "are you sure?" dialog: what this is, who wrote it, where it came from, and what it will be
   * able to do. For a plugin the Install button stays disabled until the person ticks that they trust
   * its authors (`security.trustGate`), because a plugin can do everything they can do.
   *
   * → { installed, remember }
   */
  async #ask(kind, { meta, id, url, existing, size }) {
    const { ui, security } = this.client;
    const label = KINDS[kind].label;
    const name = meta.name ?? id;
    const authors = meta.authors ?? [];
    const names = authors.map((author) => author.name).filter(Boolean);
    const vouched = names.length > 0 && names.every((author) => security.isVouchedAuthor(author));
    const knownBefore = !vouched && security.trustsAuthors(authors);
    const rows = [
      { label: 'Name', value: name },
      meta.version && { label: 'Version', value: meta.version },
      { label: 'By', value: names.length ? this.#authorsValue(authors, { vouched, knownBefore }) : 'Nobody — this file names no author' },
      meta.description && { label: 'About', value: meta.description },
      url && { label: 'From', value: ui.link({ href: url }) },
      { label: 'Size', value: `${Math.max(1, Math.round(size / 1000))} kB` },
    ].filter(Boolean);

    let gate = null;
    if (kind === 'plugins' && security.trustGate) {
      gate = {
        label: names.length
          ? `I trust ${listNames(names)} and understand this plugin can see and change anything I do in Yapin’.`
          : 'I understand this plugin names no author, and that it can see and change anything I do in Yapin’.',
        description: vouched
          ? `${this.client.name} lists ${names.length > 1 ? 'these authors' : 'this author'} as trusted.`
          : knownBefore
            ? `You said you trust ${listNames(names)} before.`
            : null,
        checked: vouched || knownBefore,
      };
    }

    let remember = false;
    const offerRemember = kind === 'plugins' && security.remembersAuthors && names.length > 0 && !vouched && !knownBefore;
    const rememberRow = offerRemember
      ? ui.checkRow({
          soft: true,
          label: `Remember that I trust ${listNames(names)}`,
          onChange: (on) => {
            remember = on;
          },
        })
      : null;

    const installed = await ui.confirm({
      title: existing ? `Update ${label} “${name}”?` : `Install ${label} “${name}”?`,
      content: h('div', null, ui.keyValue(rows), ui.hint(security.warningFor(kind))),
      gate,
      footer: rememberRow,
      confirmLabel: existing ? 'Update' : `Install ${label}`,
      cancelLabel: 'Cancel',
      danger: kind === 'plugins',
    });
    return { installed, remember: installed && remember };
  }

  /** The authors row: names, linked where the header gives a link, with a tag when they're trusted. */
  #authorsValue(authors, { vouched, knownBefore }) {
    const { ui } = this.client;
    const parts = [];
    authors.forEach((author, index) => {
      if (index) parts.push(', ');
      parts.push(author.url ? ui.link({ href: author.url, label: author.name }) : author.name);
    });
    if (vouched) parts.push(' ', ui.tag(`Trusted by ${this.client.name}`, 'good'));
    else if (knownBefore) parts.push(' ', ui.tag('You trusted before'));
    return h('span', null, parts);
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
    this.client.security.forgetInstall(kind, id);
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
