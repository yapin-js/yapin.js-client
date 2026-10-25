import { ClientError, ErrorCodes } from './errors.js';
import { h } from './ui.js';
import { safeURL } from './util.js';

/**
 * The About page every client app gets in Yapin’ settings: version, build, git, environment and links.
 * Every row and section has an id and can be changed, hidden, added or removed, from the config
 * (`about: { fields: { … } }`) or from code (`client.about.set(…)`, `client.about.remove(…)`), and the
 * whole page goes away with `about: false` or `client.pages.remove('about')`.
 *
 * Field ids are '<section>.<name>': 'app.version', 'git.commit', 'environment.electron', 'links.website'.
 */
export class AboutPage {
  #sections = new Map();
  #fields = new Map();
  #actions = new Map();

  constructor(client, config = {}) {
    this.client = client;
    this.config = config;
    this.#defaults();
    this.#applyConfig();
  }

  #defaults() {
    const c = this.client;
    const { build = {}, git = null } = c.manifest;
    const env = c.environment;
    this.section('app', { title: null, order: 0, layout: 'header' });
    this.section('build', { title: 'Build', order: 10 });
    this.section('git', { title: 'Source', order: 20 });
    this.section('environment', { title: 'Environment', order: 30 });
    this.section('links', { title: 'Links', order: 40, layout: 'chips' });

    this.set('app.name', { label: 'Name', value: c.name, order: 0 });
    this.set('app.version', { label: 'Version', value: c.version, copy: true, order: 1 });
    if (c.manifest.description) this.set('app.description', { label: 'About', value: c.manifest.description, order: 2 });
    if (c.manifest.authors?.length) this.set('app.authors', { label: c.manifest.authors.length > 1 ? 'Authors' : 'Author', value: c.manifest.authors.map((a) => a.name).join(', '), order: 3 });
    if (c.safeMode) this.set('app.safeMode', { label: 'Mode', value: 'Safe mode (plugins and themes are off)', order: 4 });

    if (build.time) this.set('build.date', { label: 'Built', value: new Date(build.time).toLocaleString(), order: 0 });
    if (build.mode) this.set('build.mode', { label: 'Build', value: build.mode, order: 1 });
    this.set('build.framework', { label: 'Framework', value: `yapin.js-client ${c.manifest.framework ?? ''}`.trim(), order: 2 });
    this.set('build.pluginApi', { label: 'Plugin API', value: String(c.manifest.apiVersion ?? ''), order: 3 });

    if (git) {
      const commitURL = git.commitURL ?? null;
      if (git.branch) this.set('git.branch', { label: 'Branch', value: git.branch, order: 0 });
      if (git.commit) this.set('git.commit', { label: 'Commit', value: git.shortCommit ?? git.commit.slice(0, 7), href: commitURL, copy: git.commit, code: true, order: 1 });
      if (git.tag) this.set('git.tag', { label: 'Tag', value: git.tag, order: 2 });
      if (git.date) this.set('git.date', { label: 'Committed', value: new Date(git.date).toLocaleString(), order: 3 });
      if (git.dirty) this.set('git.dirty', { label: 'Working tree', value: 'Built with uncommitted changes', order: 4 });
      if (git.remote) this.set('git.remote', { label: 'Repository', value: git.remote, href: git.remoteURL ?? null, order: 5 });
    }

    this.set('environment.platform', { label: 'Running in', value: c.host.isDesktop ? 'Yapin’ desktop app' : 'Browser', order: 0 });
    if (c.host.desktopVersion) this.set('environment.desktop', { label: 'Desktop app', value: c.host.desktopVersion, order: 1 });
    if (env.electron) this.set('environment.electron', { label: 'Electron', value: env.electron, order: 2 });
    if (env.chrome) this.set('environment.chrome', { label: 'Chromium', value: env.chrome, order: 3 });
    if (env.node) this.set('environment.node', { label: 'Node', value: env.node, order: 4 });
    if (env.os) this.set('environment.os', { label: 'System', value: env.os, order: 5 });

    let order = 0;
    for (const [key, url] of Object.entries(c.manifest.links ?? {})) {
      if (safeURL(url, { protocols: ['https:', 'mailto:'] })) this.set(`links.${key}`, { label: titleCase(key), value: url, href: url, order: order++ });
    }

    this.action('copy', {
      label: 'Copy debug info',
      icon: 'copy',
      order: 0,
      run: async () => {
        await navigator.clipboard.writeText(this.debugInfo());
        c.ui.toast('Debug info copied', { type: 'success' });
      },
    });
    if (c.welcome?.enabled) this.action('welcome', { label: 'Welcome screen', icon: 'sparkles', order: 3, variant: 'ghost', run: () => c.welcome.show() });
    if (c.whatsNew?.enabled && c.whatsNew.config.entries?.length) this.action('whatsNew', { label: "What's new", icon: 'rocket', order: 4, variant: 'ghost', run: () => c.whatsNew.show() });
    if (c.native) {
      this.action('folder', { label: 'Data folder', icon: 'folder', order: 1, variant: 'ghost', run: () => c.native.openFolder('data') });
      this.action('safeMode', {
        label: c.safeMode ? 'Restart normally' : 'Safe mode',
        icon: 'shield',
        order: 2,
        variant: 'ghost',
        run: async () => {
          if (await c.ui.confirm({ title: c.safeMode ? 'Restart normally?' : 'Restart in safe mode?', message: c.safeMode ? 'Plugins and themes will load again.' : 'Yapin’ restarts with every plugin and theme turned off, so you can fix one that breaks things.', confirmLabel: 'Restart' })) {
            c.native.relaunch({ safeMode: !c.safeMode });
          }
        },
      });
    }
  }

  #applyConfig() {
    const { sections = {}, fields = {}, actions = {} } = this.config;
    for (const [id, value] of Object.entries(sections)) {
      if (value === false) this.removeSection(id);
      else this.section(id, value === true ? {} : value);
    }
    for (const [id, value] of Object.entries(fields)) {
      if (value === false) this.remove(id);
      else this.set(id, typeof value === 'string' ? { value } : value);
    }
    for (const [id, value] of Object.entries(actions)) {
      if (value === false) this.removeAction(id);
    }
  }

  /**
   * Adds or changes a section: section('support', { title: 'Support', order: 35, layout: 'rows' }).
   * Layouts: 'rows' (label and value, the default), 'chips' (compact pills, for links) and 'header'
   * (the card at the top: its `name`, `version` and `description` fields become the title, a version
   * tag and the line under it; any other field is shown small underneath).
   */
  section(id, { title, order, layout } = {}) {
    const existing = this.#sections.get(id);
    this.#sections.set(id, {
      id,
      title: title === undefined ? existing?.title ?? id : title,
      order: order ?? existing?.order ?? 100,
      layout: LAYOUTS.has(layout) ? layout : existing?.layout ?? 'rows',
    });
    this.#changed();
    return this;
  }

  /** The sections, in order: [{ id, title, order, layout }]. */
  sections() {
    return this.#sortedSections().map((s) => ({ ...s }));
  }

  removeSection(id) {
    this.#sections.delete(id);
    for (const key of [...this.#fields.keys()]) if (key.startsWith(`${id}.`)) this.#fields.delete(key);
    this.#changed();
    return this;
  }

  /**
   * Adds or changes a row. `id` is '<section>.<name>'. Options: label, value (text, or a function
   * returning text), href (makes it a link), copy (true, or the text to copy), code (monospace), order.
   * Only the options you pass change.
   */
  set(id, options = {}) {
    const [sectionId] = String(id).split('.');
    if (!String(id).includes('.')) throw new ClientError(ErrorCodes.InvalidDefinition, `About field ids look like "section.name", got "${id}"`);
    if (!this.#sections.has(sectionId)) this.section(sectionId, { title: titleCase(sectionId) });
    const existing = this.#fields.get(id) ?? { id, section: sectionId, label: titleCase(id.split('.').pop()), order: 100 };
    this.#fields.set(id, { ...existing, ...options, id, section: sectionId });
    this.#changed();
    return this;
  }

  get(id) {
    const field = this.#fields.get(id);
    return field ? { ...field } : null;
  }

  remove(id) {
    const removed = this.#fields.delete(id);
    this.#changed();
    return removed;
  }

  fields() {
    return [...this.#fields.values()].map((f) => ({ ...f }));
  }

  /** A button under the header: action('report', { label, icon, run, variant, order }). */
  action(id, { label, icon = null, run, variant = 'primary', order = 100 } = {}) {
    if (typeof run !== 'function') throw new ClientError(ErrorCodes.InvalidDefinition, `About action "${id}" needs a run function`);
    this.#actions.set(id, { id, label: label ?? id, icon, run, variant, order });
    this.#changed();
    return this;
  }

  removeAction(id) {
    this.#actions.delete(id);
    this.#changed();
    return this;
  }

  /** Everything on the page as plain text, plus recent errors and log lines, for bug reports. */
  debugInfo() {
    const lines = [`${this.client.name} ${this.client.version}`];
    for (const section of this.#sortedSections()) {
      const fields = this.#sortedFields(section.id);
      if (!fields.length) continue;
      lines.push('', `[${section.title ?? section.id}]`);
      for (const f of fields) lines.push(`${f.label}: ${valueText(f)}`);
    }
    const plugins = this.client.plugins.list({ includeHidden: true }).filter((p) => p.enabled);
    if (plugins.length) lines.push('', '[Plugins]', ...plugins.map((p) => `${p.id} ${p.version ?? ''} (${p.source}, ${p.status})`));
    const themes = this.client.themes.list().filter((t) => t.enabled);
    if (themes.length) lines.push('', '[Themes]', ...themes.map((t) => `${t.id} ${t.version ?? ''} (${t.source})`));
    const logs = this.client.logger.history.entries.filter((e) => e.level === 'error' || e.level === 'warn').slice(-20);
    if (logs.length) lines.push('', '[Recent problems]', ...logs.map((e) => `${new Date(e.time).toISOString()} ${e.level} ${e.name}: ${e.message}`));
    return lines.join('\n');
  }

  #sortedSections() {
    return [...this.#sections.values()].sort((a, b) => a.order - b.order);
  }

  #sortedFields(sectionId) {
    return [...this.#fields.values()].filter((f) => f.section === sectionId && !f.hidden).sort((a, b) => a.order - b.order);
  }

  #changed() {
    this.onChange?.();
  }

  /** Draws the page into `root`. Used as the page's render function. */
  render(root, ctx) {
    const { ui } = this.client;
    const draw = () => {
      const sections = this.#sortedSections()
        .map((section) => ({ ...section, fields: this.#sortedFields(section.id) }))
        .filter((section) => section.fields.length);
      const header = sections.find((s) => s.layout === 'header');
      const cards = sections.filter((s) => s !== header);
      root.replaceChildren(
        ui.heading(this.config.title ?? 'About'),
        h(
          'div',
          { class: 'yc-about' },
          header && this.#header(header),
          this.config.intro && ui.hint(this.config.intro),
          this.#actionBar(),
          cards.length > 0 && h('div', { class: 'yc-about-grid' }, cards.map((s) => this.#card(s))),
        ),
      );
    };
    this.onChange = draw;
    draw();
    ctx?.onDispose(() => {
      if (this.onChange === draw) this.onChange = null;
    });
  }

  #header(section) {
    const { ui } = this.client;
    const field = (name) => section.fields.find((f) => f.id === `${section.id}.${name}`);
    const [name, version, description] = [field('name'), field('version'), field('description')];
    const rest = section.fields.filter((f) => f !== name && f !== version && f !== description);
    const title = name ? valueText(name) : this.client.name;
    const logo = this.config.logo ? ui.icon(this.config.logo) : null;
    return h(
      'div',
      { class: 'yc-about-header', dataset: { section: section.id } },
      h('div', { class: 'yc-about-logo', attrs: { 'aria-hidden': 'true' } }, logo ?? title.trim().charAt(0).toUpperCase()),
      h(
        'div',
        { class: 'yc-grow' },
        h('div', { class: 'yc-about-title' }, title, version && h('span', { class: 'yc-about-version' }, `v${valueText(version).replace(/^v/, '')}`, version.copy && this.#copyButton(version))),
        description && h('div', { class: 'yc-about-desc' }, valueText(description)),
        rest.length > 0 && h('div', { class: 'yc-about-meta' }, rest.map((f) => h('span', null, h('span', { class: 'yc-about-label' }, f.label), ' ', this.#value(f)))),
      ),
    );
  }

  #actionBar() {
    const { ui } = this.client;
    const actions = [...this.#actions.values()].sort((a, b) => a.order - b.order);
    if (!actions.length) return null;
    return h('div', { class: 'yc-about-actions' }, actions.map((a) => ui.button({ label: a.label, icon: a.icon, variant: a.variant, small: true, onClick: () => a.run(this.client) })));
  }

  #card(section) {
    return h(
      'section',
      { class: 'yc-about-card', dataset: { section: section.id, layout: section.layout } },
      section.title && h('div', { class: 'yc-section-title' }, section.title),
      section.layout === 'chips' ? this.#chips(section.fields) : this.#rows(section.fields),
    );
  }

  #rows(fields) {
    return h(
      'dl',
      { class: 'yc-about-rows' },
      fields.flatMap((f) => [h('dt', null, f.label), h('dd', null, this.#value(f))]),
    );
  }

  #chips(fields) {
    const { ui } = this.client;
    return h(
      'div',
      { class: 'yc-about-chips' },
      fields.map((f) => {
        if (f.href) return h(ui.link({ href: f.href, label: f.label, title: valueText(f) }), { class: 'yc-about-chip' }, ui.icon('external'));
        return h('span', { class: 'yc-about-chip', title: f.label }, this.#value(f));
      }),
    );
  }

  #value(field) {
    const { ui } = this.client;
    const text = valueText(field);
    const content = field.href ? ui.link({ href: field.href, label: text }) : field.code ? h('code', null, text) : text;
    return h('span', { class: 'yc-about-value', title: text }, h('span', { class: 'yc-about-text' }, content), field.copy && this.#copyButton(field));
  }

  #copyButton(field) {
    const { ui } = this.client;
    const text = field.copy === true ? valueText(field) : String(field.copy);
    const button = h('button', {
      type: 'button',
      class: 'yc-about-copy',
      title: `Copy ${field.label.toLowerCase()}`,
      attrs: { 'aria-label': `Copy ${field.label.toLowerCase()}` },
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          button.replaceChildren(ui.icon('check'));
          setTimeout(() => button.isConnected && button.replaceChildren(ui.icon('copy')), 1200);
        } catch (error) {
          ui.toast(`Couldn't copy: ${error?.message ?? error}`, { type: 'error' });
        }
      },
    }, ui.icon('copy'));
    return button;
  }
}

const LAYOUTS = new Set(['rows', 'chips', 'header']);

function valueText(field) {
  try {
    const value = typeof field.value === 'function' ? field.value() : field.value;
    return value === undefined || value === null ? '' : String(value);
  } catch {
    return '(unavailable)';
  }
}

function titleCase(text) {
  return String(text)
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}
