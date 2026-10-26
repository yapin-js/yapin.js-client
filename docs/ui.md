# UI kit

`client.ui` (and `ctx.ui` in plugins and pages) builds controls that look like Yapin’s own. They use Yapin’s classes (`btn`, `input`, `switch`, `toggle-row`, `field`, `hint`) through the [host adapter](host-adapter.md), so they follow Yapin’s styles and the active theme. Everything returns a plain DOM element.

## h()

```js
import { h } from 'yapin.js-client/runtime';   // or ctx.h

h('div', { class: 'row', style: { gap: '8px' }, onClick: () => {} },
  'Hello ',
  h('b', null, name),
  items.map((item) => h('li', null, item)),
);
```

| Prop | |
| --- | --- |
| `class` / `className` | A string, an array, or `{ name: boolean }`. |
| `style` | An object (custom properties work: `{ '--x': '1px' }`) or a string. |
| `dataset` | `{ key: value }` → `data-key`. |
| `attrs` | Attributes to set as-is. |
| `ref` | `(element) => {}`, called with the element. |
| `onClick`, `onInput`, … | Event listeners. |
| anything else | Set as a property if the element has it, otherwise as an attribute. |

Children can be strings, numbers, elements, arrays, or `null`/`false` (skipped). Strings are always text: `h()` never parses HTML and refuses `innerHTML`. For icons, use `ui.svg(markup)`, which keeps only drawing elements (no scripts, event handlers, `foreignObject` or external links).

## Layout

```js
ui.heading('Title')                               // <h2>
ui.hint('Muted text')
ui.section({ title: 'Advanced', description: 'Careful', children: [...] })
ui.card({ title: 'Name', meta: 'v1.0 · by Ada', icon, actions: [button], children: [...] })
ui.tag('Beta')  ui.tag('Error', 'danger')  ui.tag('Old', 'warn')
ui.empty('Nothing here yet.')
ui.keyValue([{ label: 'Version', value: '1.0.0' }, { label: 'Link', value: ui.link({ href }) }])
ui.icon(svgMarkupOrImageURL)
```

## Icons

`ui.icon()`, and anywhere else an `icon` option is accepted (page icons, About fields, `ui.card`, `ui.button`, toasts, dialogs, the [welcome and what's new screens](welcome.md)), takes:

- A built-in name: `'sparkles'`, `'rocket'`, `'puzzle'`, `'palette'`, `'sliders'`, `'info'`, `'check'`, `'x'`, `'alertTriangle'`, `'alertCircle'`, `'chevronRight'`, `'megaphone'`, `'bell'`, `'external'`, `'heart'`, `'copy'`, `'folder'`, `'shield'`.
- A name your client app registered itself (see below).
- SVG markup, sanitized (no scripts, event handlers, `foreignObject` or external links).
- An https or `data:image/…` URL.
- An element.

```js
ui.icon('rocket')
ui.button({ label: 'Install', icon: 'puzzle' })
client.pages.add({ id: 'tools', title: 'Tools', icon: 'sliders', render })
```

Every icon is a single colour that follows `currentColor`, so it matches whatever text colour it sits in, in any theme.

The built-ins are [Lucide](https://lucide.dev), so Lucide's own names work too: `'triangle-alert'` is the same icon as `'alertTriangle'`, and names match in either kebab-case or camelCase. Lucide draws at a 2 px stroke; to re-weight the whole set, set `stroke-width` on `.yc-icon svg` in your `themes.css` rather than editing the markup.

### Your own icons

The built-in set is only a default: a client app can add to it, or replace any of it. The simplest way is a folder — every `.svg` in [`icons.dirs`](configuration.md#icons) is registered under its file name, so `icons/brand.svg` becomes `icon: 'brand'`. Give an icon the same name as a built-in and yours replaces it, which is how you swap the whole look without touching the framework:

```
icons/
  brand.svg      → icon: 'brand'
  rocket.svg     → replaces the built-in 'rocket'
```

Files starting with `_` or `.` are skipped. The markup is inlined into the payload at build time, so there's no loading to wait for, and it's sanitized when it's drawn.

Icons can also be given inline in the config, which wins over a folder file of the same name:

```js
icons: { set: { brand: '<svg viewBox="0 0 24 24">…</svg>' } }
```

A plugin can register its own at runtime:

```js
client.ui.registerIcons({ sparkle: '<svg viewBox="0 0 24 24">…</svg>' });
client.ui.iconNames();  // every name available, built-in and registered
```

Write icons on a 24×24 `viewBox` with `stroke="currentColor"` and no `width`/`height` on the root `<svg>` (CSS sizes them, from 13 px in About chips up to 26 px in the About logo tile), so they theme and scale like the built-ins. Markup that isn't SVG is reported through the client app's error handler rather than drawn.

## Controls

```js
ui.button({ label: 'Save', variant: 'primary' | 'ghost' | 'danger', small: true, onClick: async () => {} })
ui.link({ href: 'https://…', label: 'Docs' })
ui.switch({ checked, onChange: (checked) => {} })
ui.toggleRow({ label: 'Compact', description: 'Less space', checked, onChange })
ui.field({ label: 'Name', description: 'Shown to others', input: ui.textInput({ … }) })
ui.textInput({ value, placeholder, type: 'text', onInput, onChange })
ui.textarea({ value, rows: 6, onInput, onChange })
ui.select({ value, options: ['a', { label: 'B', value: 'b' }], multiple: false, onChange })
ui.slider({ value, min, max, step, unit: 'px', onInput, onChange })
ui.colorInput({ value: '#7c5cff', onChange })
ui.listEditor({ value: ['a', 'b'], onChange })
```

Buttons with an async `onClick` disable themselves until it finishes. If it throws, the error is logged and shown as a toast.

Links open in the browser (on desktop, through the main process). Only https and mailto links become links; anything else is shown as text.

## Settings forms

```js
const form = ui.form(settings);   // any Settings object
root.append(form.element);
ctx.onDispose(form.dispose);
```

One control per setting, saved as the person edits, with errors shown under the control, `group` headings, and `hidden` and `disabled` re-checked after every change. See [Settings](settings.md).

## Toasts and dialogs

```js
ui.toast('Saved', { type: 'success' });                       // info | success | warning | error — each type gets a matching icon
ui.toast('Update available', { timeout: 0, action: { label: 'Restart', onClick: restart }, icon: 'rocket' });

if (await ui.confirm({ title: 'Delete everything?', message: 'This can’t be undone.', confirmLabel: 'Delete', danger: true })) { … }  // danger confirms get a warning icon automatically

const name = await ui.prompt({ title: 'Rename', value: current, validate: (v) => v.trim() !== '' || 'Can’t be empty' });

const choice = await ui.dialog({
  title: 'Pick one',
  content: someElement,
  buttons: [{ label: 'Cancel', variant: 'ghost', value: null }, { label: 'A', value: 'a' }, { label: 'B', value: 'b' }],
});
```

Dialogs close with Escape or a click outside (unless `dismissable: false`) and resolve with `null`. A button's `value` can be a function, which can throw to keep the dialog open (`prompt` uses this for validation).

## Framework styles

The framework's own elements use `yc-` classes (`.yc-page`, `.yc-card`, `.yc-toast`, `.yc-badge`, …) styled with Yapin’s variables, so they follow themes. Themes can restyle them like anything else.
