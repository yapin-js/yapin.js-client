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
ui.toast('Saved', { type: 'success' });                       // info | success | warning | error
ui.toast('Update available', { timeout: 0, action: { label: 'Restart', onClick: restart } });

if (await ui.confirm({ title: 'Delete everything?', message: 'This can’t be undone.', confirmLabel: 'Delete', danger: true })) { … }

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
