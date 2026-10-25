# Themes

A theme is a CSS file with a metadata header:

```css
/**
 * @id midnight
 * @name Midnight
 * @description Deep blue, low contrast.
 * @version 1.2.0
 * @author Ada <https://ada.dev>
 * @tags dark, blue
 * @preview https://example.com/midnight.png
 * @var --accent color #7c5cff Accent colour
 * @var --radius number 10 Corner radius | min=0 max=20 unit=px
 * @var --density select comfy Density | options=compact,comfy,roomy
 */
:root:root:root:root {
  --bg-main: #0e1020;
  --bg-side: #0b0d1a;
  --bg-rail: #080914;
}
.msg { border-radius: var(--radius); }
```

## Where themes come from

| Source | How |
| --- | --- |
| **bundled** | `.css` files in your `themes/` folder, built into the client app. |
| **user** | Installed from a link on the Themes page, or (desktop) dropped into the themes folder. Editing the file reloads it. |
| **code** | `client.themes.add({ id, css, variables, vars })` or `ctx.themes.add(…)` from a plugin. |

## The header

| Tag | |
| --- | --- |
| `@id` | Lowercase letters, digits and dashes. Defaults to the file name (`Midnight Theme.theme.css` becomes `midnight-theme`). |
| `@name`, `@description`, `@version`, `@author` (repeatable, or comma-separated), `@tags`, `@website`/`@source`, `@preview` (an image URL) | Shown on the Themes page. |
| `@var` | A variable people can change ([below](#variables)). |

Unknown tags are kept in `meta.extra`, so you can add your own.

## Variables

`@var --name type default Label | key=value …` turns a CSS variable into a setting on the Themes page. When the person changes it, the theme is re-applied with the new value straight away.

| Type | Default looks like | Options |
| --- | --- | --- |
| `color` | `#7c5cff` | |
| `number` | `10` | `min`, `max`, `step`, `unit` (appended to the value, like `px`) |
| `slider` | `10` | `min`, `max` (default 0 and 100), `step`, `unit` |
| `select` | `comfy` | `options=a,b,c` |
| `switch` | `true` / `false` | `on`, `off`: the CSS values for each state (default `1` and `0`) |
| `text` | `"quoted if it has spaces"` | |

Values that could break out of the declaration (`;`, `{`, `}`, `</`, comments) are dropped.

From code, `vars` takes the same fields as objects:

```js
client.themes.add({
  id: 'brand',
  name: 'Brand colours',
  vars: [{ variable: '--accent', type: 'color', default: '#8b5cf6', label: 'Accent' }],
  css: '.btn { border-radius: 999px; }',
});
```

## Winning against Yapin’s CSS

Yapin’ defines its colours as variables on `:root`, and redefines them for light mode and tinted servers with selectors like `:root[data-theme=light]`, `:root[data-tint]` and `:root[data-srv-tint]`. A plain `:root { --bg-main: … }` in a theme loses to those. Use `:root:root:root:root`, which is more specific than any of them (it's exported as `VARIABLE_SELECTOR`). The framework uses it for `@var` values and `variables`.

Themes are applied with `adoptedStyleSheets`, after Yapin’s own stylesheets, so at equal specificity a theme wins. Order in the cascade:

1. Yapin’s CSS
2. the framework's own CSS (its pages and controls)
3. plugin styles
4. your base CSS (`themes.css`) and `themes.variables`
5. enabled themes, in the order they were turned on
6. Custom CSS

## Light and dark

`variables` (in the config or from code) can differ by mode:

```js
themes: {
  variables: {
    '--accent': '#8b5cf6',
    dark: { '--bg-main': '#14121c' },
    light: { '--bg-main': '#fbfaff' },
  },
},
```

In a theme file, use Yapin’s attribute: `:root:root:root:root[data-theme=light] { … }`. From code, `client.host.colorScheme` is `'dark'` or `'light'`, and `client.host.onColorSchemeChange(fn)` tells you when it switches.

## Yapin’s variables

As of October 2026. Run `getComputedStyle(document.documentElement)` in devtools for the current list.

| Variable | Used for |
| --- | --- |
| `--bg-rail` | The server list on the far left |
| `--bg-side` | Channel list, settings nav |
| `--bg-main` | The chat area |
| `--bg-elev` | Raised surfaces |
| `--bg-float`, `--bg-floating` | Popovers and menus |
| `--bg-hover`, `--bg-active` | Hover and selected rows |
| `--bg-input` | Text fields |
| `--text`, `--text-muted`, `--text-faint` | Text |
| `--border` | Borders |
| `--accent`, `--accent-hover`, `--accent-soft`, `--on-accent` | The accent colour |
| `--danger`, `--success`, `--warning` | States |
| `--shadow`, `--radius`, `--font` | Shape and type |

Useful classes: `.msg`, `.msg-head`, `.msg-author`, `.msg-text`, `.msg-time`, `.avatar`, `.rail-item`, `.modal`, `.ctx-menu`, `.settings-nav`, `.settings-main`, `.btn`, `.input`, `.switch`, `.toggle-row`, `.hint`, `.pc-sub-row` (profile cards), `.badge-row`, `.voice-tile`.

## Managing themes

```js
client.themes.enable('midnight');
client.themes.disable('midnight');
client.themes.toggle('midnight');
client.themes.list();                       // [{ id, name, enabled, source, hasSettings, … }]
client.themes.settings('midnight').set('accent', '#ff3366');
client.themes.customCSS = '.msg-author { font-weight: 700; }';
```

With `themes.multiple: false`, enabling one theme turns the others off.

## Your client app's own look

`themes.css` (a file) and `themes.variables` are always applied, under the themes, so a theme can still change them. Use them for your brand rather than shipping a theme that's always on. Safe mode turns these off too.

## Custom CSS

The Themes page has a Custom CSS box (unless `themes.customCSS.enabled` is false). It applies after every theme and updates as the person types. From code: `client.themes.customCSS`.

## Checking a theme

```sh
npx yapin-client validate midnight.theme.css
```

This checks the header, each `@var`, and that the braces balance.
