# Settings

Plugins, themes and your client app describe their settings with the same schema. The framework stores them, validates every change, and draws the form.

```js
settings: {
  enabled: { type: 'switch', label: 'Show timestamps', default: true },
  format: { type: 'select', label: 'Format', options: [{ label: '24-hour', value: '24h' }, { label: '12-hour', value: '12h' }], default: '24h' },
  size: { type: 'slider', label: 'Size', min: 10, max: 20, step: 1, default: 13, unit: 'px', group: 'Look' },
  color: { type: 'color', label: 'Colour', default: '#9c9daa', group: 'Look', hidden: (s) => !s.get('enabled') },
}
```

## Types

| Type | Value | Options |
| --- | --- | --- |
| `switch` (or `boolean`) | `true` / `false` | |
| `text` (or `string`) | text | `placeholder`, `minLength`, `maxLength`, `pattern` (+ `patternFlags`, `patternMessage`), `trim`, `secret` (shows as a password field) |
| `textarea` | text | like `text`, plus `rows` |
| `number` | number | `min`, `max`, `step`, `integer` |
| `slider` | number | `min` and `max` (required), `step`, `unit` (shown next to the value) |
| `select` | one of the options | `options`: values, or `{ label, value, description }`; `multiple: true` for a list |
| `color` | `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` | |
| `list` | a list of text | `maxItems`, `placeholder` |
| `button` | none | `action(context)` (required), `buttonLabel`, `variant` |
| `custom` | anything JSON | `render({ value, save, settings, disabled, ui })` returns an element, or `{ element, dispose }` |

Every setting can also have:

| | |
| --- | --- |
| `label`, `description` | Shown in the form. |
| `default` | Used until the person changes it. Checked when the schema loads, so a bad default fails early. |
| `group` | Settings with the same group appear under one heading. |
| `order` | Position in the form (default: the order they're written). |
| `hidden`, `disabled` | `true`, or a function of the settings, re-checked after every change. |
| `validate(value, settings)` | Return `true`, `false` or a message. |
| `onChange(value, old, key)` | Called after the value changes. |

Setting names are letters, digits, `_` and `-`, starting with a letter.

## Reading and writing

```js
ctx.settings.get('format');              // the saved value, or the default
ctx.settings.all();                      // { enabled: true, format: '24h', … }
ctx.settings.set('size', 15);            // validated; throws a ClientError saying what's wrong
ctx.settings.set('size', '15');          // numbers typed as text are accepted for number and slider
ctx.settings.check('size', 99);          // 'must be at most 20' (doesn't save)
ctx.settings.reset('size');              // back to the default; reset() for all
ctx.settings.onChange('size', (value, old) => {});
ctx.settings.onChange((value, old, key) => {});   // any setting
ctx.settings.state('color');             // { hidden, disabled } right now
```

A saved value that no longer passes validation (say you lowered a `max`) reads as the default rather than breaking the plugin.

## Forms

The Plugins and Themes pages draw forms for you. On your own pages:

```js
render(root, ctx) {
  const form = ctx.ui.form(ctx.client.settings);
  root.append(ctx.ui.heading('Settings'), form.element);
  ctx.onDispose(form.dispose);
}
```

## Storage

Settings are stored per owner: `plugin.<id>.settings`, `theme.<id>` and `client`. For data that isn't a setting, use `ctx.storage` (a plugin's own namespace) or `client.storage.namespace('name')`:

```js
const cache = client.storage.namespace('my-cache');
cache.set('lastSeen', Date.now());
cache.get('lastSeen', 0);
cache.update('count', (n) => n + 1, 0);
cache.onChange((key, value, old) => {});
```

Values are JSON, copied in and out, so changing an object you got from `get` doesn't change what's stored until you `set` it. Each namespace is capped at 2 MB. On desktop they're files in the data folder; on the web they're in `localStorage`.
