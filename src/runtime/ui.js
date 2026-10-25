import { SettingTypes } from './settings.js';
import { builtinIcon } from '../shared/icons.js';
import { safeURL, toArray } from './util.js';

/**
 * Builds DOM elements. Text is always set as text, never parsed as HTML, so values from settings,
 * plugins or remote sources can't inject markup.
 *
 *   h('div', { class: 'row', onClick: fn, style: { gap: '8px' } }, 'Hello ', h('b', null, name))
 *
 * Props: `class` (string, array or { name: bool }), `style` (object or string), `dataset`, `attrs`,
 * `ref(fn)`, `on<Event>` listeners, and anything else as a property (or attribute if it isn't one).
 */
export function h(tag, props, ...children) {
  const doc = globalThis.document;
  const element = tag instanceof Node ? tag : doc.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class' || key === 'className') element.className = classNames(value);
    else if (key === 'style') {
      if (typeof value === 'string') element.style.cssText = value;
      else for (const [prop, v] of Object.entries(value)) prop.startsWith('--') ? element.style.setProperty(prop, v) : (element.style[prop] = v);
    } else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key === 'attrs') for (const [name, v] of Object.entries(value)) element.setAttribute(name, v === true ? '' : String(v));
    else if (key === 'ref') value(element);
    else if (/^on[A-Z]/.test(key) && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'innerHTML' || key === 'outerHTML') throw new TypeError(`h() doesn't set ${key}; build elements, or use ui.svg() for icons`);
    else if (key in element) element[key] = value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

function append(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) append(parent, child);
    else if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(globalThis.document.createTextNode(String(child)));
  }
}

export function classNames(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(classNames).filter(Boolean).join(' ');
  return Object.entries(value).filter(([, on]) => on).map(([name]) => name).join(' ');
}

const SVG_ALLOWED = new Set([
  'svg', 'g', 'path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'defs', 'lineargradient', 'radialgradient', 'stop', 'title', 'clippath', 'mask', 'use', 'symbol',
]);

/**
 * Turns SVG markup into an element, keeping only drawing elements and attributes: no scripts, event
 * handlers, foreignObject or external links. For icons on pages and badges.
 */
export function svg(markup) {
  if (typeof markup !== 'string' || !markup.includes('<svg')) return null;
  // Parsed as XML, an <svg> without xmlns is a plain element that draws nothing; inline-HTML markup often leaves it out.
  let source = /<svg\b[^>]*\sxmlns=/.test(markup) ? markup : markup.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (source.includes('xlink:') && !/\sxmlns:xlink=/.test(source)) source = source.replace(/<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) return null;
  const clean = (node) => {
    for (const child of [...node.children]) {
      if (!SVG_ALLOWED.has(child.nodeName.toLowerCase())) child.remove();
      else clean(child);
    }
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && !value.startsWith('#')) || value.startsWith('javascript:') || name === 'style') {
        node.removeAttribute(attr.name);
      }
    }
  };
  clean(root);
  return globalThis.document.importNode(root, true);
}

const TOAST_ICONS = { info: 'info', success: 'check', warning: 'alertTriangle', error: 'alertCircle' };

export const baseCSS = `
.yc-page{display:flex;flex-direction:column;gap:4px;min-width:0}
.yc-page h2{margin:0 0 12px}
.yc-page a,.yc-dialog a{color:var(--accent);text-decoration:none}
.yc-page a:hover,.yc-dialog a:hover{text-decoration:underline}
.yc-section{margin:18px 0 6px}
.yc-section-title{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--text-muted);margin-bottom:6px}
.yc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.yc-grow{flex:1;min-width:0}
.yc-kv{display:grid;grid-template-columns:minmax(120px,max-content) 1fr;gap:8px 16px;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--border)}
.yc-kv dt{color:var(--text-muted);font-size:13px}
.yc-kv dd{margin:0;word-break:break-word;font-size:14px}
.yc-about{display:flex;flex-direction:column;gap:12px}
.yc-about-header{display:flex;gap:14px;align-items:center;background:var(--bg-elev);border:1px solid var(--border);border-radius:var(--radius,10px);padding:14px 16px}
.yc-about-logo{width:48px;height:48px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent);font-size:22px;font-weight:700}
.yc-about-logo .yc-icon{width:26px;height:26px}
.yc-about-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:17px;font-weight:700}
.yc-about-version{display:inline-flex;align-items:center;gap:2px;font-size:11.5px;font-weight:600;padding:1px 4px 1px 8px;border-radius:999px;background:var(--bg-active);color:var(--text-muted)}
.yc-about-desc{color:var(--text-muted);font-size:13px;margin-top:2px}
.yc-about-meta{display:flex;flex-wrap:wrap;gap:2px 14px;font-size:12.5px;margin-top:6px}
.yc-about-label{color:var(--text-muted)}
.yc-about-actions{display:flex;flex-wrap:wrap;gap:6px}
.yc-about-actions .yc-icon{width:15px;height:15px;margin-right:4px}
.yc-about-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.yc-about-card{background:var(--bg-elev);border:1px solid var(--border);border-radius:var(--radius,10px);padding:10px 14px;min-width:0}
.yc-about-rows{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:4px 12px;margin:0;font-size:13px;align-items:center}
.yc-about-rows dt{color:var(--text-muted)}
.yc-about-rows dd{margin:0;min-width:0}
.yc-about-value{display:inline-flex;align-items:center;gap:2px;max-width:100%;min-width:0;vertical-align:middle}
.yc-about-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.yc-about-copy{display:inline-flex;flex-shrink:0;border:0;background:none;color:var(--text-muted);cursor:pointer;padding:2px;border-radius:5px}
.yc-about-copy:hover{background:var(--bg-hover);color:var(--text)}
.yc-about-copy .yc-icon{width:14px;height:14px}
.yc-about-chips{display:flex;flex-wrap:wrap;gap:6px}
.yc-about-chip{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:3px 10px;border-radius:999px;background:var(--bg-active);font-size:12.5px;color:var(--text)}
.yc-page a.yc-about-chip{color:var(--text)}
.yc-page a.yc-about-chip:hover{text-decoration:none;background:var(--bg-hover)}
.yc-about-chip .yc-icon{width:13px;height:13px;color:var(--text-muted)}
.yc-kv code,.yc-about code,.yc-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;background:var(--bg-input);border-radius:6px;padding:1px 6px}
.yc-card{background:var(--bg-elev);border:1px solid var(--border);border-radius:var(--radius,10px);padding:12px 14px;margin:8px 0}
.yc-card-head{display:flex;align-items:center;gap:10px}
.yc-card-title{font-weight:600}
.yc-card-meta{color:var(--text-muted);font-size:12.5px}
.yc-card-body{margin-top:10px}
.yc-tag{display:inline-block;font-size:11px;font-weight:600;padding:1px 6px;border-radius:999px;background:var(--bg-active);color:var(--text-muted)}
.yc-tag.yc-warn{background:color-mix(in srgb,var(--warning,#f5b544) 22%,transparent);color:var(--warning,#f5b544)}
.yc-tag.yc-danger{background:color-mix(in srgb,var(--danger,#f2555a) 22%,transparent);color:var(--danger,#f2555a)}
.yc-error{color:var(--danger,#f2555a);font-size:12.5px;margin-top:4px}
.yc-empty{color:var(--text-muted);padding:24px 0;text-align:center}
.yc-field-row{display:flex;gap:8px;align-items:center}
.yc-field-row input[type=range]{flex:1}
.yc-color{width:44px;height:32px;padding:2px;border-radius:6px;border:1px solid var(--border);background:var(--bg-input);cursor:pointer}
.yc-textarea{min-height:120px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;width:100%;box-sizing:border-box}
.yc-list-item{display:flex;gap:6px;margin-bottom:6px}
.yc-icon{display:inline-flex;width:18px;height:18px;flex-shrink:0;vertical-align:middle}
.yc-icon svg,.yc-icon img{width:100%;height:100%}
.yc-nav-item{display:flex;align-items:center;gap:8px}
.yc-toasts{position:fixed;z-index:2147483000;bottom:20px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}
.yc-toast{pointer-events:auto;background:var(--bg-float,#1b1c21);color:var(--text,#ececf1);border:1px solid var(--border);box-shadow:var(--shadow);border-radius:var(--radius,10px);padding:10px 14px;font-size:14px;max-width:min(520px,90vw);display:flex;gap:10px;align-items:center;animation:yc-in .15s ease-out}
.yc-toast[data-type=success]{border-left:3px solid var(--success,#3fcf82)}
.yc-toast[data-type=success] .yc-icon{color:var(--success,#3fcf82)}
.yc-toast[data-type=error]{border-left:3px solid var(--danger,#f2555a)}
.yc-toast[data-type=error] .yc-icon{color:var(--danger,#f2555a)}
.yc-toast[data-type=warning]{border-left:3px solid var(--warning,#f5b544)}
.yc-toast[data-type=warning] .yc-icon{color:var(--warning,#f5b544)}
.yc-toast[data-type=info] .yc-icon{color:var(--accent)}
.yc-backdrop{position:fixed;inset:0;z-index:2147482000;background:#0009;display:flex;align-items:center;justify-content:center;padding:16px;animation:yc-in .12s ease-out}
.yc-dialog{background:var(--bg-float,#1b1c21);color:var(--text,#ececf1);border:1px solid var(--border);border-radius:calc(var(--radius,10px) + 4px);box-shadow:var(--shadow);width:min(460px,100%);max-height:90vh;overflow:auto;padding:20px}
.yc-dialog-head{display:flex;align-items:center;gap:10px}
.yc-dialog-head .yc-icon{width:22px;height:22px;color:var(--accent);flex-shrink:0}
.yc-dialog-head.yc-danger .yc-icon{color:var(--danger,#f2555a)}
.yc-dialog-head h3{margin:0 0 8px;font-size:18px}
.yc-dialog h3{margin:0 0 8px;font-size:18px}
.yc-dialog p{margin:0 0 12px;color:var(--text-muted);white-space:pre-wrap}
.yc-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.yc-badges{display:inline-flex;gap:3px;align-items:center;vertical-align:middle;margin-left:4px}
.yc-badge{display:inline-flex;align-items:center;justify-content:center;border-radius:4px;cursor:default}
.yc-badge[data-href]{cursor:pointer}
.yc-badge img,.yc-badge svg{width:100%;height:100%;object-fit:contain}
@keyframes yc-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
`;

/**
 * Ready-made controls that look like Yapin’s own (they use its classes, through the host adapter),
 * plus toasts and dialogs. Everything returns plain DOM elements.
 */
export class UI {
  #toastRoot = null;

  constructor({ host, openExternal, onError } = {}) {
    this.host = host;
    this.openExternal = openExternal ?? ((url) => globalThis.open?.(url, '_blank', 'noopener,noreferrer'));
    this.onError = onError ?? ((error) => console.error(error));
    this.h = h;
    this.svg = svg;
  }

  #cls(...keys) {
    return this.host ? this.host.className(...keys) : keys.join(' ');
  }

  heading(text, level = 2) {
    return h(`h${level}`, null, text);
  }

  hint(text) {
    return h('div', { class: this.#cls('hint') }, text);
  }

  section({ title, description, children = [] } = {}) {
    return h('div', { class: 'yc-section' }, title && h('div', { class: 'yc-section-title' }, title), description && this.hint(description), children);
  }

  card({ title, meta, actions = [], children = [], icon } = {}) {
    return h(
      'div',
      { class: 'yc-card' },
      h('div', { class: 'yc-card-head' }, icon && this.icon(icon), h('div', { class: 'yc-grow' }, h('div', { class: 'yc-card-title' }, title), meta && h('div', { class: 'yc-card-meta' }, meta)), actions),
      toArray(children).length ? h('div', { class: 'yc-card-body' }, children) : null,
    );
  }

  tag(text, variant) {
    return h('span', { class: ['yc-tag', variant && `yc-${variant}`] }, text);
  }

  empty(text) {
    return h('div', { class: 'yc-empty' }, text);
  }

  /** An icon: a built-in name ('rocket', 'puzzle', …), SVG markup (sanitized), an https/data image URL, or an element. */
  icon(source) {
    if (!source) return null;
    if (source instanceof Node) return h('span', { class: 'yc-icon' }, source);
    if (typeof source === 'string' && !source.includes('<') && !/^(https?:|data:)/.test(source)) source = builtinIcon(source) ?? source;
    const asSvg = svg(source);
    if (asSvg) return h('span', { class: 'yc-icon', attrs: { 'aria-hidden': 'true' } }, asSvg);
    const url = safeURL(source, { protocols: ['https:', 'data:'] });
    if (url && (url.protocol === 'https:' || /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(url.href))) {
      return h('span', { class: 'yc-icon', attrs: { 'aria-hidden': 'true' } }, h('img', { src: url.href, alt: '', referrerPolicy: 'no-referrer' }));
    }
    return null;
  }

  button({ label, variant = 'primary', small = false, disabled = false, title, onClick, icon } = {}) {
    const classes = [this.#cls('button')];
    if (variant === 'ghost') classes.push(this.#cls('buttonGhost'));
    if (variant === 'danger') classes.push(this.#cls('buttonDanger'));
    if (small) classes.push(this.#cls('buttonSmall'));
    const element = h('button', { type: 'button', class: classes, disabled, title }, icon && this.icon(icon), label);
    if (onClick) {
      element.addEventListener('click', async (event) => {
        if (element.disabled) return;
        element.disabled = true;
        try {
          await onClick(event);
        } catch (error) {
          this.onError(error);
          this.toast(error?.message ?? String(error), { type: 'error' });
        } finally {
          if (element.isConnected) element.disabled = disabled;
        }
      });
    }
    return element;
  }

  /** A link that opens in the browser. Only https URLs (and mailto:) become links. */
  link({ href, label, title } = {}) {
    const url = safeURL(href, { protocols: ['https:', 'mailto:'] });
    if (!url) return h('span', null, label ?? href ?? '');
    return h(
      'a',
      {
        href: url.href,
        title: title ?? url.href,
        rel: 'noopener noreferrer',
        target: '_blank',
        onClick: (event) => {
          event.preventDefault();
          this.openExternal(url.href);
        },
      },
      label ?? url.href,
    );
  }

  switch({ checked = false, disabled = false, onChange, label } = {}) {
    return h('input', {
      type: 'checkbox',
      class: this.#cls('switch'),
      checked,
      disabled,
      attrs: label ? { 'aria-label': label } : undefined,
      onChange: onChange ? (event) => onChange(event.target.checked, event) : undefined,
    });
  }

  toggleRow({ label, description, checked, disabled, onChange } = {}) {
    return h(
      'label',
      { class: this.#cls('toggleRow') },
      h('div', null, h('div', { class: this.#cls('toggleLabel') }, label), description && this.hint(description)),
      this.switch({ checked, disabled, onChange }),
    );
  }

  field({ label, description, input, error, id } = {}) {
    const inputId = id ?? input?.id ?? `yc-${Math.random().toString(36).slice(2, 9)}`;
    if (input && !input.id) input.id = inputId;
    return h('div', { class: this.#cls('field') }, label && h('label', { htmlFor: inputId }, label), input, description && this.hint(description), error && h('div', { class: 'yc-error' }, error));
  }

  textInput({ value = '', placeholder, type = 'text', maxLength, disabled, onInput, onChange } = {}) {
    return h('input', {
      type,
      class: this.#cls('input'),
      value,
      placeholder,
      maxLength,
      disabled,
      spellcheck: false,
      onInput: onInput ? (event) => onInput(event.target.value, event) : undefined,
      onChange: onChange ? (event) => onChange(event.target.value, event) : undefined,
    });
  }

  textarea({ value = '', placeholder, rows = 6, disabled, onInput, onChange } = {}) {
    return h('textarea', {
      class: [this.#cls('input'), 'yc-textarea'],
      value,
      placeholder,
      rows,
      disabled,
      spellcheck: false,
      onInput: onInput ? (event) => onInput(event.target.value, event) : undefined,
      onChange: onChange ? (event) => onChange(event.target.value, event) : undefined,
    });
  }

  select({ value, options = [], disabled, multiple = false, onChange } = {}) {
    const list = options.map((o) => (o !== null && typeof o === 'object' ? o : { label: String(o), value: o }));
    const element = h(
      'select',
      {
        class: this.#cls('input'),
        disabled,
        multiple,
        onChange: onChange
          ? (event) => {
              const picked = [...event.target.selectedOptions].map((option) => list[Number(option.dataset.index)].value);
              onChange(multiple ? picked : picked[0], event);
            }
          : undefined,
      },
      list.map((o, index) => h('option', { value: String(index), dataset: { index: String(index) }, selected: multiple ? toArray(value).includes(o.value) : o.value === value }, o.label)),
    );
    return element;
  }

  slider({ value = 0, min = 0, max = 100, step = 1, unit = '', disabled, onInput, onChange } = {}) {
    const readout = h('span', { class: 'yc-card-meta' }, `${value}${unit}`);
    const input = h('input', {
      type: 'range',
      min,
      max,
      step,
      value,
      disabled,
      onInput: (event) => {
        readout.textContent = `${event.target.value}${unit}`;
        onInput?.(Number(event.target.value), event);
      },
      onChange: onChange ? (event) => onChange(Number(event.target.value), event) : undefined,
    });
    return h('div', { class: 'yc-field-row' }, input, readout);
  }

  colorInput({ value = '#000000', disabled, onInput, onChange } = {}) {
    const hex = h('input', { type: 'text', class: this.#cls('input'), value, maxLength: 9, disabled, spellcheck: false, style: { width: '110px' } });
    const picker = h('input', { type: 'color', class: 'yc-color', value: value.slice(0, 7), disabled });
    picker.addEventListener('input', (event) => {
      hex.value = event.target.value;
      onInput?.(event.target.value, event);
    });
    picker.addEventListener('change', (event) => onChange?.(event.target.value, event));
    hex.addEventListener('change', (event) => {
      if (/^#[0-9a-f]{6}$/i.test(event.target.value)) picker.value = event.target.value;
      onChange?.(event.target.value, event);
    });
    return h('div', { class: 'yc-field-row' }, picker, hex);
  }

  listEditor({ value = [], placeholder, disabled, onChange } = {}) {
    const items = [...value];
    const root = h('div');
    const render = () => {
      root.replaceChildren(
        ...items.map((item, index) =>
          h(
            'div',
            { class: 'yc-list-item' },
            this.textInput({
              value: item,
              placeholder,
              disabled,
              onChange: (text) => {
                items[index] = text;
                onChange?.([...items]);
              },
            }),
            this.button({
              label: 'Remove',
              variant: 'ghost',
              small: true,
              disabled,
              onClick: () => {
                items.splice(index, 1);
                render();
                onChange?.([...items]);
              },
            }),
          ),
        ),
        this.button({
          label: 'Add',
          variant: 'ghost',
          small: true,
          disabled,
          onClick: () => {
            items.push('');
            render();
          },
        }),
      );
    };
    render();
    return root;
  }

  /** A definition list of label/value rows. Values may be text, elements, or { text, href, copy }. */
  keyValue(rows) {
    return h(
      'dl',
      { class: 'yc-kv' },
      rows.flatMap(({ label, value }) => [h('dt', null, label), h('dd', null, value)]),
    );
  }

  /** Shows a short message at the bottom of the window. type: info | success | warning | error. */
  toast(message, { type = 'info', timeout = 4000, action, icon = TOAST_ICONS[type] } = {}) {
    const doc = globalThis.document;
    if (!doc?.body) return () => {};
    if (!this.#toastRoot?.isConnected) {
      this.#toastRoot = h('div', { class: 'yc-toasts', attrs: { role: 'status', 'aria-live': 'polite' } });
      doc.body.appendChild(this.#toastRoot);
    }
    const element = h('div', { class: 'yc-toast', dataset: { type } }, this.icon(icon), h('span', { class: 'yc-grow' }, message), action && this.button({ label: action.label, small: true, variant: 'ghost', onClick: () => (close(), action.onClick()) }));
    const close = () => element.remove();
    this.#toastRoot.appendChild(element);
    if (timeout > 0) setTimeout(close, timeout);
    return close;
  }

  /** A modal dialog. Resolves with the value of the button pressed, or null when dismissed. `icon` shows next to the title. */
  dialog({ title, icon, message, content, buttons = [{ label: 'OK', value: true }], dismissable = true } = {}) {
    const doc = globalThis.document;
    if (!doc?.body) return Promise.resolve(null);
    return new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        doc.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        resolve(value);
      };
      const onKey = (event) => {
        if (event.key === 'Escape' && dismissable) {
          event.stopPropagation();
          finish(null);
        }
      };
      const actions = buttons.map((b) => this.button({ label: b.label, variant: b.variant ?? 'primary', onClick: async () => finish(typeof b.value === 'function' ? await b.value() : b.value) }));
      const head = title && (icon ? h('div', { class: ['yc-dialog-head', buttons.some((b) => b.variant === 'danger') && 'yc-danger'] }, this.icon(icon), h('h3', null, title)) : h('h3', null, title));
      const dialog = h('div', { class: 'yc-dialog', attrs: { role: 'dialog', 'aria-modal': 'true' } }, head, message && h('p', null, message), content, h('div', { class: 'yc-dialog-actions' }, actions));
      const backdrop = h('div', { class: 'yc-backdrop', onMousedown: (event) => event.target === backdrop && dismissable && finish(null) }, dialog);
      doc.addEventListener('keydown', onKey, true);
      doc.body.appendChild(backdrop);
      actions[actions.length - 1]?.focus();
    });
  }

  async confirm({ title = 'Are you sure?', message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, icon = danger ? 'alertTriangle' : null, content } = {}) {
    const value = await this.dialog({
      title,
      icon,
      message,
      content,
      buttons: [
        { label: cancelLabel, variant: 'ghost', value: false },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', value: true },
      ],
    });
    return value === true;
  }

  /** Asks for a line of text. Resolves with it, or null if cancelled. */
  async prompt({ title, message, placeholder, value = '', confirmLabel = 'OK', validate } = {}) {
    const input = this.textInput({ value, placeholder });
    const error = h('div', { class: 'yc-error' });
    const result = await this.dialog({
      title,
      message,
      content: h('div', null, input, error),
      buttons: [
        { label: 'Cancel', variant: 'ghost', value: null },
        {
          label: confirmLabel,
          value: async () => {
            const verdict = validate ? await validate(input.value) : true;
            if (verdict !== true) {
              error.textContent = typeof verdict === 'string' ? verdict : 'Not valid';
              throw new Error(error.textContent);
            }
            return input.value;
          },
        },
      ],
    });
    return result;
  }

  /**
   * A form for a Settings object: one control per setting, saved as you edit, with `hidden` and
   * `disabled` re-evaluated after every change. Returns { element, dispose }.
   */
  form(settings, { context } = {}) {
    const root = h('div', { class: 'yc-form' });
    const disposers = [];
    const rows = new Map();
    const renderRow = (key) => {
      const def = settings.definitions[key];
      const { hidden, disabled } = settings.state(key);
      if (hidden) return h('div', { hidden: true });
      const error = h('div', { class: 'yc-error', hidden: true });
      const save = (value) => {
        try {
          settings.set(key, value);
          error.hidden = true;
        } catch (err) {
          error.textContent = err.message.replace(/^.*?setting "[^"]+" /, '');
          error.hidden = false;
        }
      };
      const value = SettingTypes[def.type].stateless ? undefined : settings.get(key);
      let input;
      switch (def.type) {
        case 'switch':
          return h('div', null, this.toggleRow({ label: def.label, description: def.description, checked: value, disabled, onChange: save }), error);
        case 'text':
          input = this.textInput({ value, placeholder: def.placeholder, maxLength: def.maxLength, disabled, onChange: save, type: def.secret ? 'password' : 'text' });
          break;
        case 'textarea':
          input = this.textarea({ value, placeholder: def.placeholder, rows: def.rows ?? 6, disabled, onChange: save });
          break;
        case 'number':
          input = this.textInput({ value: String(value), type: 'number', disabled, onChange: save });
          if (def.min !== undefined) input.min = def.min;
          if (def.max !== undefined) input.max = def.max;
          if (def.step !== undefined) input.step = def.step;
          break;
        case 'slider':
          input = this.slider({ value, min: def.min, max: def.max, step: def.step ?? 1, unit: def.unit ?? '', disabled, onChange: save });
          break;
        case 'select':
          input = this.select({ value, options: def.options, multiple: def.multiple, disabled, onChange: save });
          break;
        case 'color':
          input = this.colorInput({ value, disabled, onChange: save });
          break;
        case 'list':
          input = this.listEditor({ value, placeholder: def.placeholder, disabled, onChange: save });
          break;
        case 'button':
          input = this.button({ label: def.buttonLabel ?? def.label, variant: def.variant ?? 'ghost', disabled, onClick: () => def.action(context ?? settings) });
          return h('div', { class: this.#cls('field') }, input, def.description && this.hint(def.description));
        case 'custom': {
          const out = def.render({ value, settings, context, save, disabled, ui: this });
          if (typeof out?.dispose === 'function') disposers.push(out.dispose);
          input = out?.element ?? out;
          break;
        }
        default:
          input = this.hint(`Unsupported setting type ${def.type}`);
      }
      const field = this.field({ label: def.label, description: def.description, input });
      field.appendChild(error);
      return field;
    };
    const keys = Object.keys(settings.definitions).sort((a, b) => settings.definitions[a].order - settings.definitions[b].order);
    let currentGroup = null;
    let groupBody = root;
    for (const key of keys) {
      const group = settings.definitions[key].group ?? null;
      if (group !== currentGroup) {
        currentGroup = group;
        groupBody = group ? h('div') : root;
        if (group) root.appendChild(this.section({ title: group, children: [groupBody] }));
      }
      const row = renderRow(key);
      rows.set(key, row);
      groupBody.appendChild(row);
    }
    disposers.push(
      settings.onChange('*', () => {
        for (const key of keys) {
          const before = rows.get(key);
          const state = settings.state(key);
          if (state.hidden !== before.hidden || state.disabled !== Boolean(before.querySelector('[disabled]'))) {
            const next = renderRow(key);
            before.replaceWith(next);
            rows.set(key, next);
          }
        }
      }),
    );
    return {
      element: root,
      dispose: () => {
        for (const dispose of disposers.splice(0)) {
          try {
            dispose();
          } catch (error) {
            this.onError(error);
          }
        }
      },
    };
  }
}
