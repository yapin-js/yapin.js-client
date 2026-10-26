import { Settings } from './settings.js';

const MAX_AUTHORS = 200;
const MAX_INSTALLS = 200;

/** The default warning shown before a plugin or theme the person chose is installed. */
export const INSTALL_WARNING = {
  plugins: 'Plugins run with full access to Yapin’ in this window, including your account: they can read your messages, act as you, and send anything they see somewhere else. Nothing can undo that afterwards, so only install plugins from people you trust.',
  themes: 'Themes only change how Yapin’ looks. They can load images and fonts from other websites, which tells those websites you are using the theme.',
};

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function authorNames(authors = []) {
  return authors.map((author) => (typeof author === 'string' ? author : author?.name)).filter(Boolean);
}

/** "Ada", "Ada and Bo", "Ada, Bo and Cy". */
export function listNames(names = []) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What a client app allows, what the person using it chose, and who they have said they trust.
 *
 * Nothing the person installs themselves runs before they have seen what it is and agreed, and for
 * plugins they have to say in as many words that they trust whoever wrote it. Two things decide the
 * rules: the client app's config (`security` in yapin-client.config.js), fixed when the client app is
 * built, and the person's own settings on the Security page. The person can only make the rules
 * stricter — a client app that asks before every install can't be talked out of it from the page.
 *
 *   client.security.trustsAuthors(meta.authors)   // have they said they trust these people before?
 *   client.security.trustAuthors(meta.authors)    // remember that they do
 *   client.security.installs()                    // what they installed, from where, and when
 */
export class Security {
  #store;

  constructor(client, config = {}) {
    this.client = client;
    this.config = config;
    this.#store = client.storage.namespace('security');
    this.settings = new Settings(this.#schema(), this.#store, { owner: 'Security', onError: (error) => client.reportError(error) });
  }

  #schema() {
    const config = this.config;
    const linksOffEverywhere = ['plugins', 'themes'].every((kind) => {
      const user = this.client.config[kind]?.user ?? {};
      return user.enabled === false || user.install?.url === false;
    });
    return {
      installFromLinks: {
        type: 'switch',
        label: 'Allow installing from links',
        description: 'Off means plugins and themes can only come from files you put in the folder yourself.',
        default: true,
        hidden: () => linksOffEverywhere,
      },
      confirmEveryInstall: {
        type: 'switch',
        label: 'Always ask before installing',
        description:
          config.confirmInstall === 'plugins'
            ? 'Show what a theme is and who made it before it is installed. Plugins are always asked about.'
            : `${this.client.name} always asks before installing, so this can't be turned off.`,
        default: true,
        disabled: () => config.confirmInstall !== 'plugins',
      },
      rememberAuthors: {
        type: 'switch',
        label: 'Remember authors I trust',
        description: 'Tick the box for an author once, and the next plugin from them starts out ticked.',
        default: true,
        hidden: () => config.rememberAuthors === false,
        onChange: (on) => {
          if (!on) this.forgetAuthors();
        },
      },
    };
  }

  /** Whether the person still allows installing from a link (the client app's rules are checked separately). */
  get installFromLinks() {
    return this.settings.get('installFromLinks') !== false;
  }

  /** Whether installing this kind has to be confirmed by hand. Plugins always do. */
  shouldConfirm(kind) {
    if (kind === 'plugins') return true;
    if (this.config.confirmInstall === 'plugins') return this.settings.get('confirmEveryInstall') !== false;
    return true;
  }

  /** Whether a plugin install needs "I trust the authors" ticked before it can go ahead. */
  get trustGate() {
    return this.config.trustGate !== false;
  }

  /** Whether authors the person trusts are remembered between installs. */
  get remembersAuthors() {
    return this.config.rememberAuthors !== false && this.settings.get('rememberAuthors') !== false;
  }

  /** The warning shown in the install dialog; a client app can word it its own way. */
  warningFor(kind) {
    const configured = this.config.warning;
    const text = typeof configured === 'string' ? configured : configured?.[kind];
    return text ?? INSTALL_WARNING[kind];
  }

  // ---------- authors ----------

  /** Authors the client app itself vouches for, as names. */
  vouchedAuthors() {
    return authorNames(this.config.trustedAuthors ?? []);
  }

  isVouchedAuthor(name) {
    const wanted = String(name ?? '').trim().toLowerCase();
    return Boolean(wanted) && this.vouchedAuthors().some((vouched) => vouched.toLowerCase() === wanted);
  }

  /** Authors the person said they trust: `[{ name, url, at }]`, most recent first. */
  trustedAuthors() {
    const saved = this.#store.get('authors', []);
    if (!Array.isArray(saved)) return [];
    return saved.filter((entry) => entry && typeof entry.name === 'string');
  }

  isTrustedAuthor(name) {
    const wanted = String(name ?? '').trim().toLowerCase();
    if (!wanted) return false;
    if (this.isVouchedAuthor(wanted)) return true;
    return this.remembersAuthors && this.trustedAuthors().some((entry) => entry.name.toLowerCase() === wanted);
  }

  /** True when every author given is already trusted, and there is at least one to go on. */
  trustsAuthors(authors = []) {
    const names = authorNames(authors);
    return names.length > 0 && names.every((name) => this.isTrustedAuthor(name));
  }

  /** When the person trusted this author, as an ISO date, or null. */
  trustedAt(name) {
    const wanted = String(name ?? '').trim().toLowerCase();
    return this.trustedAuthors().find((entry) => entry.name.toLowerCase() === wanted)?.at ?? null;
  }

  /** Remembers that the person trusts these authors. Does nothing when nothing is being remembered. */
  trustAuthors(authors = []) {
    if (!this.remembersAuthors) return this.trustedAuthors();
    const at = new Date().toISOString();
    const kept = this.trustedAuthors();
    for (const author of authors) {
      const name = String((typeof author === 'string' ? author : author?.name) ?? '').trim();
      if (!name || this.isVouchedAuthor(name)) continue;
      const index = kept.findIndex((entry) => entry.name.toLowerCase() === name.toLowerCase());
      if (index >= 0) kept.splice(index, 1);
      kept.unshift({ name, url: typeof author === 'string' ? null : author?.url ?? null, at });
    }
    return this.#saveAuthors(kept.slice(0, MAX_AUTHORS));
  }

  /** Forgets one author the person had trusted. */
  forgetAuthor(name) {
    const gone = String(name ?? '').trim().toLowerCase();
    return this.#saveAuthors(this.trustedAuthors().filter((entry) => entry.name.toLowerCase() !== gone));
  }

  /** Forgets every author the person had trusted. */
  forgetAuthors() {
    return this.#saveAuthors([]);
  }

  #saveAuthors(next) {
    this.#store.set('authors', next);
    this.client.events.emit('security:authors', next);
    return next;
  }

  // ---------- where what's installed came from ----------

  /** Notes what was installed, who wrote it and where it came from, for the Security page. */
  recordInstall(kind, id, { url = null, authors = [], name = null, trustedAuthors = false } = {}) {
    const records = this.#store.get('installs', {});
    const entry = {
      kind,
      id,
      name: name ?? id,
      url: url ?? null,
      host: url ? hostOf(url) : null,
      authors: authorNames(authors),
      trustedAuthors: Boolean(trustedAuthors),
      at: new Date().toISOString(),
    };
    const next = { ...records, [`${kind}:${id}`]: entry };
    const keys = Object.keys(next);
    if (keys.length > MAX_INSTALLS) {
      const oldest = keys.sort((a, b) => String(next[a].at).localeCompare(String(next[b].at))).slice(0, keys.length - MAX_INSTALLS);
      for (const key of oldest) delete next[key];
    }
    this.#store.set('installs', next);
    return entry;
  }

  /** What was noted about one installed plugin or theme, if anything. */
  installRecord(kind, id) {
    return this.#store.get('installs', {})[`${kind}:${id}`] ?? null;
  }

  /** Everything noted, most recently installed first. */
  installs() {
    return Object.values(this.#store.get('installs', {})).sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }

  forgetInstall(kind, id) {
    const records = this.#store.get('installs', {});
    if (!records[`${kind}:${id}`]) return false;
    const { [`${kind}:${id}`]: _removed, ...rest } = records;
    this.#store.set('installs', rest);
    return true;
  }
}
