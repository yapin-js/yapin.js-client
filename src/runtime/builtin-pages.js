import { h } from './ui.js';
import { debounce } from './util.js';

const PLUGIN_STATUS = {
  error: ['Error', 'danger'],
  crashed: ['Stopped after errors', 'danger'],
  incompatible: ['Not compatible', 'warn'],
};

function authorsText(authors) {
  return authors?.length ? `by ${authors.map((a) => a.name).join(', ')}` : '';
}

function searchBox(ui, placeholder, onSearch) {
  const input = ui.textInput({ placeholder, onInput: debounce((value) => onSearch(value.trim().toLowerCase()), 120) });
  input.type = 'search';
  return input;
}

function matches(query, ...fields) {
  return !query || fields.some((f) => String(f ?? '').toLowerCase().includes(query));
}

/** The Plugins page: list, search, turn on and off, settings, install and uninstall. */
export function pluginsPage(client, config = {}) {
  return {
    id: 'plugins',
    title: config.title ?? 'Plugins',
    order: config.order ?? 10,
    icon: config.icon ?? null,
    render(root, ctx) {
      const { ui } = client;
      let query = '';
      const open = new Set();
      const listEl = h('div');
      const disposers = [];
      const draw = () => {
        for (const dispose of disposers.splice(0)) dispose();
        const plugins = client.plugins.list().filter((p) => matches(query, p.name, p.id, p.description, ...(p.tags ?? [])));
        if (!plugins.length) {
          listEl.replaceChildren(ui.empty(query ? 'No plugins match.' : config.emptyText ?? 'No plugins yet.'));
          return;
        }
        listEl.replaceChildren(
          ...plugins.map((p) => {
            const tags = [p.source === 'user' ? ui.tag('Installed') : null, p.required ? ui.tag('Required') : null, PLUGIN_STATUS[p.status] ? ui.tag(...PLUGIN_STATUS[p.status]) : null].filter(Boolean);
            const actions = [];
            if (p.hasSettings && p.compatible) {
              actions.push(
                ui.button({
                  label: open.has(p.id) ? 'Hide settings' : 'Settings',
                  variant: 'ghost',
                  small: true,
                  onClick: () => {
                    open.has(p.id) ? open.delete(p.id) : open.add(p.id);
                    draw();
                  },
                }),
              );
            }
            if (p.source === 'user') {
              actions.push(
                ui.button({
                  label: 'Uninstall',
                  variant: 'ghost',
                  small: true,
                  onClick: async () => {
                    if (await ui.confirm({ title: `Uninstall ${p.name}?`, message: 'Its settings are removed too.', confirmLabel: 'Uninstall', danger: true })) {
                      await client.userContent.uninstall('plugins', p.id);
                      draw();
                    }
                  },
                }),
              );
            }
            actions.push(
              ui.switch({
                checked: p.enabled,
                disabled: p.required || !p.compatible || client.safeMode,
                label: `Enable ${p.name}`,
                onChange: async (on, event) => {
                  try {
                    await client.plugins.toggle(p.id, on);
                  } catch (error) {
                    event.target.checked = !on;
                    ui.toast(error.message, { type: 'error' });
                  }
                  draw();
                },
              }),
            );
            const body = [];
            if (p.description) body.push(h('div', null, p.description));
            if (p.error && p.status !== 'running') body.push(h('div', { class: 'yc-error' }, p.error));
            if (p.incompatible) body.push(h('div', { class: 'yc-error' }, p.incompatible));
            if (tags.length) body.push(h('div', { class: 'yc-row', style: { marginTop: '6px' } }, tags));
            if (open.has(p.id)) {
              const form = ui.form(client.plugins.get(p.id).settings, { context: client.plugins.get(p.id) });
              disposers.push(form.dispose);
              body.push(h('div', { style: { marginTop: '10px' } }, form.element));
            }
            return ui.card({ title: p.name, meta: [p.version && `v${p.version}`, authorsText(p.authors)].filter(Boolean).join(' · '), actions, children: body });
          }),
        );
      };
      const toolbar = [searchBox(ui, 'Search plugins', (q) => ((query = q), draw()))];
      if (client.userContent.canInstallFromURL('plugins')) {
        toolbar.push(
          ui.button({
            label: 'Install from link',
            small: true,
            onClick: async () => {
              const url = await ui.prompt({ title: 'Install a plugin', message: 'Paste a link to a plugin file (https).', placeholder: 'https://…/my-plugin.plugin.js', confirmLabel: 'Next' });
              if (!url) return;
              const id = await client.userContent.install('plugins', { url });
              if (id && (await ui.confirm({ title: 'Turn it on now?', confirmLabel: 'Turn on' }))) await client.plugins.enable(id);
              draw();
            },
          }),
        );
      }
      if (client.native && client.userContent.allowed('plugins')) toolbar.push(ui.button({ label: 'Open folder', small: true, variant: 'ghost', onClick: () => client.userContent.openFolder('plugins') }));
      root.append(
        ui.heading(config.title ?? 'Plugins'),
        client.safeMode ? ui.hint('Safe mode is on, so no plugins are running.') : config.intro ? ui.hint(config.intro) : null,
        h('div', { class: 'yc-row', style: { margin: '8px 0' } }, toolbar),
        listEl,
      );
      draw();
      const offs = ['plugin:add', 'plugin:remove', 'plugin:start', 'plugin:stop', 'plugin:crash', 'plugin:update'].map((event) => client.events.on(event, () => draw()));
      ctx.onDispose(() => {
        offs.forEach((off) => off());
        for (const dispose of disposers.splice(0)) dispose();
      });
    },
  };
}

/** The Themes page: list, turn on and off, variables, install, custom CSS. */
export function themesPage(client, config = {}) {
  return {
    id: 'themes',
    title: config.title ?? 'Themes',
    order: config.order ?? 20,
    icon: config.icon ?? null,
    render(root, ctx) {
      const { ui } = client;
      let query = '';
      const open = new Set();
      const listEl = h('div');
      const disposers = [];
      const draw = () => {
        for (const dispose of disposers.splice(0)) dispose();
        const themes = client.themes.list().filter((t) => matches(query, t.name, t.id, t.description, ...(t.tags ?? [])));
        if (!themes.length) {
          listEl.replaceChildren(ui.empty(query ? 'No themes match.' : config.emptyText ?? 'No themes yet.'));
          return;
        }
        listEl.replaceChildren(
          ...themes.map((t) => {
            const actions = [];
            if (t.hasSettings) {
              actions.push(ui.button({ label: open.has(t.id) ? 'Hide options' : 'Options', variant: 'ghost', small: true, onClick: () => (open.has(t.id) ? open.delete(t.id) : open.add(t.id), draw()) }));
            }
            if (t.source === 'user') {
              actions.push(
                ui.button({
                  label: 'Uninstall',
                  variant: 'ghost',
                  small: true,
                  onClick: async () => {
                    if (await ui.confirm({ title: `Uninstall ${t.name}?`, confirmLabel: 'Uninstall', danger: true })) {
                      await client.userContent.uninstall('themes', t.id);
                      draw();
                    }
                  },
                }),
              );
            }
            actions.push(ui.switch({ checked: t.enabled, disabled: client.safeMode, label: `Enable ${t.name}`, onChange: (on) => (client.themes.toggle(t.id, on), draw()) }));
            const body = [];
            if (t.preview) {
              const preview = ui.icon(t.preview);
              if (preview) {
                preview.style.width = '100%';
                preview.style.height = 'auto';
                body.push(preview);
              }
            }
            if (t.description) body.push(h('div', null, t.description));
            if (t.source === 'user') body.push(h('div', { class: 'yc-row', style: { marginTop: '6px' } }, ui.tag('Installed')));
            if (open.has(t.id)) {
              const settings = client.themes.settings(t.id);
              const form = ui.form(settings);
              disposers.push(form.dispose);
              body.push(h('div', { style: { marginTop: '10px' } }, form.element, ui.button({ label: 'Reset options', variant: 'ghost', small: true, onClick: () => (settings.reset(), draw()) })));
            }
            return ui.card({ title: t.name, meta: [t.version && `v${t.version}`, authorsText(t.authors)].filter(Boolean).join(' · '), actions, children: body });
          }),
        );
      };
      const toolbar = [searchBox(ui, 'Search themes', (q) => ((query = q), draw()))];
      if (client.userContent.canInstallFromURL('themes')) {
        toolbar.push(
          ui.button({
            label: 'Install from link',
            small: true,
            onClick: async () => {
              const url = await ui.prompt({ title: 'Install a theme', message: 'Paste a link to a .css theme file (https).', placeholder: 'https://…/my-theme.theme.css', confirmLabel: 'Next' });
              if (!url) return;
              const id = await client.userContent.install('themes', { url });
              if (id) client.themes.enable(id);
              draw();
            },
          }),
        );
      }
      if (client.native && client.userContent.allowed('themes')) toolbar.push(ui.button({ label: 'Open folder', small: true, variant: 'ghost', onClick: () => client.userContent.openFolder('themes') }));
      const parts = [ui.heading(config.title ?? 'Themes'), client.safeMode ? ui.hint('Safe mode is on, so no themes are applied.') : config.intro ? ui.hint(config.intro) : null, h('div', { class: 'yc-row', style: { margin: '8px 0' } }, toolbar), listEl];
      if (client.themes.config.customCSS?.enabled !== false) {
        const save = debounce((css) => {
          client.themes.customCSS = css;
        }, 300);
        parts.push(
          ui.section({
            title: client.themes.config.customCSS?.title ?? 'Custom CSS',
            description: client.themes.config.customCSS?.description ?? 'Applied after every theme. Changes show up as you type.',
            children: [ui.textarea({ value: client.themes.customCSS, rows: 10, placeholder: '.msg-author { font-weight: 700; }', onInput: save })],
          }),
        );
        ctx.onDispose(() => save.flush?.());
      }
      root.append(...parts);
      draw();
      const offs = ['theme:add', 'theme:remove', 'theme:update', 'theme:enable', 'theme:disable'].map((event) => client.events.on(event, () => draw()));
      ctx.onDispose(() => {
        offs.forEach((off) => off());
        for (const dispose of disposers.splice(0)) dispose();
      });
    },
  };
}
