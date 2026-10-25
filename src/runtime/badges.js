import { ClientError, ErrorCodes, tagError } from './errors.js';
import { h, svg } from './ui.js';
import { findUserId } from './react.js';
import { parseDuration, safeURL, toArray } from './util.js';
import { idPattern } from '../shared/constants.js';

const SIZES = { sm: 14, md: 18, lg: 22 };

/**
 * Badges next to people's names. The framework ships none; client apps and plugins add providers:
 *
 *   // from a JSON file your server hosts (see docs/badges.md for the format)
 *   client.badges.addProvider({ id: 'supporters', url: 'https://api.example.com/badges.json', refresh: '30m' });
 *
 *   // or from code, per user
 *   client.badges.addProvider({ id: 'staff', async get(userId) { return isStaff(userId) ? [{ id: 'staff', label: 'Staff', icon }] : []; } });
 *
 * Badges are drawn into the "slots" in the config (profile cards and message names by default). Every
 * badge is sanitised: icons must be https or data images (or SVG markup, which is cleaned), links must
 * be https, and labels are text.
 */
export class BadgeManager {
  #providers = new Map();
  #static = new Map();
  #cache = new Map();
  #inflight = new Map();
  #rendered = new Map();
  #timers = new Map();

  constructor(client, config = {}) {
    this.client = client;
    this.config = config;
    this.ttl = parseDuration(config.cache?.ttl ?? '15m', 900_000);
    this.max = config.max ?? 6;
  }

  addProvider(provider, { owner = null } = {}) {
    if (!provider || typeof provider !== 'object') throw new ClientError(ErrorCodes.InvalidDefinition, 'A badge provider needs a definition object');
    if (!idPattern.test(provider.id ?? '')) throw new ClientError(ErrorCodes.InvalidDefinition, `Badge provider id "${provider.id}" must be lowercase letters, digits and dashes`);
    if (this.#providers.has(provider.id)) throw new ClientError(ErrorCodes.DuplicateId, `A badge provider "${provider.id}" already exists`);
    if (!provider.url && typeof provider.get !== 'function' && typeof provider.getMany !== 'function' && typeof provider.load !== 'function') {
      throw new ClientError(ErrorCodes.InvalidDefinition, `Badge provider "${provider.id}" needs url, load(), get(userId) or getMany(userIds)`);
    }
    const record = { ...provider, owner, priority: provider.priority ?? 0, table: null, loading: null };
    this.#providers.set(provider.id, record);
    if (record.url || record.load) {
      const refresh = parseDuration(record.refresh ?? '30m', 1_800_000);
      void this.#loadTable(record);
      if (refresh > 0) {
        const timer = setInterval(() => void this.#loadTable(record), Math.max(60_000, refresh));
        timer.unref?.();
        this.#timers.set(record.id, timer);
      }
    }
    this.#changed();
    return () => this.removeProvider(provider.id);
  }

  removeProvider(id) {
    if (!this.#providers.delete(id)) return false;
    clearInterval(this.#timers.get(id));
    this.#timers.delete(id);
    this.#cache.clear();
    this.#changed();
    return true;
  }

  removeOwned(owner) {
    for (const provider of [...this.#providers.values()]) if (provider.owner === owner) this.removeProvider(provider.id);
    for (const [userId, list] of this.#static) this.#static.set(userId, list.filter((b) => b.owner !== owner));
    this.#changed();
  }

  providers() {
    return [...this.#providers.values()].map((p) => ({ id: p.id, name: p.name ?? p.id, url: p.url ?? null, loaded: Boolean(p.table) }));
  }

  /** Gives one person a badge from code. Returns a function that takes it away again. */
  add(userId, badge, { owner = null } = {}) {
    const normalized = this.normalize(badge, 'static');
    if (!normalized) throw new ClientError(ErrorCodes.InvalidDefinition, 'That badge has no usable id, label or icon');
    const entry = { ...normalized, owner };
    const key = String(userId);
    this.#static.set(key, [...(this.#static.get(key) ?? []), entry]);
    this.#cache.delete(key);
    this.#changed(key);
    return () => {
      this.#static.set(key, (this.#static.get(key) ?? []).filter((b) => b !== entry));
      this.#cache.delete(key);
      this.#changed(key);
    };
  }

  /** Cleans up one badge; returns null if it can't be shown safely. */
  normalize(badge, provider) {
    if (!badge || typeof badge !== 'object') return null;
    const label = typeof badge.label === 'string' ? badge.label.slice(0, 80) : '';
    const id = String(badge.id ?? label).slice(0, 64);
    let icon = null;
    if (typeof badge.icon === 'string') {
      if (badge.icon.trim().startsWith('<svg')) icon = { svg: badge.icon };
      else {
        const url = safeURL(badge.icon, { protocols: ['https:', 'data:'] });
        if (url && (url.protocol === 'https:' || /^data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(url.href))) icon = { src: url.href };
      }
    }
    if (!id || (!label && !icon)) return null;
    const href = safeURL(badge.href ?? '', { protocols: ['https:'] })?.href ?? null;
    const color = typeof badge.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(badge.color) ? badge.color : null;
    const background = typeof badge.background === 'string' && /^#[0-9a-f]{3,8}$/i.test(badge.background) ? badge.background : null;
    return { id, label, description: typeof badge.description === 'string' ? badge.description.slice(0, 200) : '', icon, href, color, background, provider, priority: Number(badge.priority ?? 0) };
  }

  /** Every badge one person has, from all providers. */
  async for(userId) {
    const key = String(userId);
    const cached = this.#cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (this.#inflight.has(key)) return this.#inflight.get(key);
    const run = this.#collect(key).then((value) => {
      this.#cache.set(key, { value, expires: Date.now() + this.ttl });
      this.#inflight.delete(key);
      return value;
    });
    this.#inflight.set(key, run);
    return run;
  }

  /** The cached badges for a person, without fetching (null if not known yet). */
  peek(userId) {
    const cached = this.#cache.get(String(userId));
    return cached ? cached.value : null;
  }

  /** Reloads URL providers and forgets cached results, then redraws. */
  async refresh(id) {
    const list = id ? [this.#providers.get(id)].filter(Boolean) : [...this.#providers.values()];
    await Promise.all(list.filter((p) => p.url || p.load).map((p) => this.#loadTable(p)));
    this.#cache.clear();
    this.#changed();
  }

  async #collect(userId) {
    const providers = [...this.#providers.values()].sort((a, b) => b.priority - a.priority);
    const lists = await Promise.all(
      providers.map(async (provider) => {
        try {
          let list = [];
          if (provider.table) list = provider.table.get(userId) ?? [];
          else if (provider.loading) list = (await provider.loading)?.get(userId) ?? [];
          if (typeof provider.get === 'function') list = [...list, ...toArray(await provider.get(userId))];
          return list.map((badge) => this.normalize(badge, provider.id)).filter(Boolean);
        } catch (error) {
          this.client.reportError(tagError(error, { where: `badges ${provider.id}` }));
          return [];
        }
      }),
    );
    const out = [...(this.#static.get(userId) ?? []), ...lists.flat()];
    const seen = new Set();
    return out
      .filter((b) => {
        const key = `${b.provider}:${b.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.priority - a.priority)
      .slice(0, this.max);
  }

  #loadTable(provider) {
    provider.loading = (async () => {
      try {
        const data = provider.load ? await provider.load() : await this.client.api.request({ url: provider.url, responseType: 'json', timeout: 15_000 });
        provider.table = parseTable(data);
        this.#cache.clear();
        this.#changed();
        return provider.table;
      } catch (error) {
        this.client.reportError(tagError(error, { where: `badges ${provider.id}` }));
        return provider.table;
      } finally {
        provider.loading = null;
      }
    })();
    return provider.loading;
  }

  #changed(userId) {
    this.client.events.emit('badges:update', userId ?? null);
    for (const [element, info] of this.#rendered) {
      if (!element.isConnected) this.#rendered.delete(element);
      else if (!userId || info.userId === userId) void this.#draw(element, info);
    }
  }

  /** Builds the element for a list of badges. */
  render(badges, { size = 'md' } = {}) {
    const px = typeof size === 'number' ? size : SIZES[size] ?? SIZES.md;
    return h(
      'span',
      { class: 'yc-badges', dataset: { ycBadges: this.client.id } },
      badges.map((badge) => {
        const icon = badge.icon?.svg ? svg(badge.icon.svg) : badge.icon?.src ? h('img', { src: badge.icon.src, alt: '', referrerPolicy: 'no-referrer', loading: 'lazy', draggable: false }) : null;
        const element = h(
          'span',
          {
            class: 'yc-badge',
            title: badge.description ? `${badge.label}\n${badge.description}` : badge.label,
            attrs: { role: 'img', 'aria-label': badge.label || badge.id },
            dataset: { badge: badge.id, provider: badge.provider, ...(badge.href ? { href: badge.href } : {}) },
            style: { width: icon ? `${px}px` : 'auto', height: `${px}px`, color: badge.color ?? undefined, background: badge.background ?? undefined, fontSize: `${Math.round(px * 0.65)}px`, padding: icon ? '0' : '0 4px' },
          },
          icon ?? badge.label,
        );
        if (badge.href) {
          element.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.client.openExternal(badge.href);
          });
        }
        return element;
      }),
    );
  }

  #slots = new Map();
  #watching = new Map();
  #started = false;

  /** Starts drawing badges into the slots. */
  start() {
    if (this.config.enabled === false) return;
    this.#started = true;
    for (const [name, slot] of Object.entries(this.slots())) if (slot) this.#watch(name, slot);
  }

  #watch(name, slot) {
    this.#watching.get(name)?.();
    const stop = this.client.dom.observe(slot.selector, (element) => {
      let userId = null;
      try {
        userId = typeof slot.userId === 'function' ? slot.userId(element) : findUserId(element, slot.userIdProps ?? this.client.host.config.userIdProps);
      } catch (error) {
        this.client.reportError(tagError(error, { where: `badge slot ${name}` }));
      }
      if (!userId) return undefined;
      const info = { slot: name, config: slot, userId: String(userId), container: null };
      this.#rendered.set(element, info);
      void this.#draw(element, info);
      return () => {
        info.container?.remove();
        this.#rendered.delete(element);
      };
    });
    this.#watching.set(name, stop);
  }

  /**
   * Adds (or replaces) a slot from code, where `userId` can be a function of the element:
   * addSlot('members', { selector: '.member-row', position: 'append', userId: (el) => el.dataset.id }).
   * Returns a function that removes it.
   */
  addSlot(name, slot) {
    if (!slot?.selector) throw new ClientError(ErrorCodes.InvalidDefinition, `Badge slot "${name}" needs a selector`);
    this.#slots.set(name, { position: 'append', size: 'md', ...slot });
    if (this.#started) this.#watch(name, this.#slots.get(name));
    return () => this.removeSlot(name);
  }

  removeSlot(name) {
    this.#slots.delete(name);
    this.#watching.get(name)?.();
    this.#watching.delete(name);
  }

  /** The slots in use: the defaults, then config.badges.slots, then addSlot(). A slot set to false is off. */
  slots() {
    const { selectors } = this.client.host;
    const defaults = {
      profile: { selector: selectors.profileBadges, position: 'append', size: 'md' },
      message: { selector: selectors.messageAuthor, position: 'after', size: 'sm' },
    };
    const configured = this.config.slots ?? {};
    const out = {};
    for (const key of new Set([...Object.keys(defaults), ...Object.keys(configured)])) {
      const value = configured[key];
      out[key] = value === false ? null : { ...defaults[key], ...(value === true ? {} : value) };
      if (out[key] && !out[key].selector) out[key] = null;
    }
    for (const [key, slot] of this.#slots) out[key] = slot;
    return out;
  }

  async #draw(element, info) {
    const badges = this.peek(info.userId) ?? (await this.for(info.userId));
    if (!element.isConnected || this.#rendered.get(element) !== info) return;
    info.container?.remove();
    info.container = null;
    if (!badges.length) return;
    const container = this.render(badges, { size: info.config.size });
    const position = info.config.position ?? 'append';
    if (position === 'prepend') element.prepend(container);
    else if (position === 'before') element.before(container);
    else if (position === 'after') element.after(container);
    else element.append(container);
    info.container = container;
  }

  stop() {
    for (const timer of this.#timers.values()) clearInterval(timer);
    this.#timers.clear();
  }
}

/**
 * The URL provider format: `{ badges: { id: { label, icon, href, … } }, users: { userId: [id | badge] } }`.
 * A plain `{ userId: [badge, …] }` map works too.
 */
export function parseTable(data) {
  const table = new Map();
  if (!data || typeof data !== 'object') return table;
  const definitions = data.badges && typeof data.badges === 'object' ? data.badges : {};
  const users = data.users && typeof data.users === 'object' ? data.users : data.badges ? {} : data;
  for (const [userId, list] of Object.entries(users)) {
    const resolved = toArray(list)
      .map((item) => (typeof item === 'string' ? (definitions[item] ? { id: item, ...definitions[item] } : null) : item))
      .filter(Boolean);
    if (resolved.length) table.set(String(userId), resolved);
  }
  return table;
}
