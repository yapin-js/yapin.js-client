# Getting started

## 1. Create the project

```sh
npx yapin.js-client init my-client
cd my-client
npm install
```

`init` creates:

| Path | What it's for |
| --- | --- |
| `yapin-client.config.js` | Your client app's name and options ([Configuration](configuration.md)) |
| `src/index.js` | Your code. It runs in the Yapin’ page before plugins start. |
| `plugins/` | Plugins built into your client app. It starts empty. |
| `themes/` | Themes built into your client app. It starts empty. |
| `installer/marketing.json` | The installer page's text, colours and images |
| `assets/` | For your logo and screenshots |

The framework ships no plugins or themes. Everything in `plugins/` and `themes/` is yours.

## 2. Name it

Open `yapin-client.config.js`:

```js
import { defineConfig } from 'yapin.js-client';

export default defineConfig({
  id: 'nebula',            // folders and storage use this; lowercase, digits, dashes
  name: 'Nebula',          // shown in settings and the installer
  description: 'A calmer Yapin’.',
  authors: ['Ada'],
  links: { website: 'https://nebula.example', source: 'https://github.com/ada/nebula' },
  entry: './src/index.js',
});
```

The `version` comes from `package.json` unless you set it here.

## 3. Try it in the desktop app

```sh
npm run dev
```

This builds a development version, installs it into the Yapin’ desktop app on your computer, and watches your files. Every save rebuilds, and the Yapin’ window reloads by itself. If Yapin’ is open, `dev` stops and asks you to close it. Run `npx yapin-client dev --close` to let it close Yapin’ for you.

Open **Settings** in Yapin’. Below Yapin’s own entries there's a section with your client app's name, holding **About**, **Plugins** and **Themes**.

In development builds the client object is available in the devtools console (Ctrl+Shift+I) as `window.nebula`, your id in camelCase.

## 4. Add something

A page:

```js
// src/index.js
export default function setup(client) {
  client.pages.add({
    id: 'welcome',
    title: 'Welcome',
    render(root, { ui }) {
      root.append(ui.heading('Welcome to Nebula'), ui.hint('Thanks for trying it.'));
    },
  });
}
```

A plugin, in `plugins/hello.js`:

```js
import { definePlugin } from 'yapin.js-client/runtime';

export default definePlugin({
  id: 'hello',
  name: 'Hello',
  description: 'Says hello when Yapin’ starts.',
  enabledByDefault: true,
  start(ctx) {
    ctx.toast(`Hello from ${ctx.client.name}`);
  },
});
```

A theme, in `themes/midnight.css`:

```css
/**
 * @id midnight
 * @name Midnight
 * @var --accent color #7c5cff Accent colour
 */
:root:root:root:root {
  --bg-main: #0e0f13;
  --bg-side: #0b0c10;
  --bg-rail: #08090c;
}
```

Save, and the dev build picks them up.

## 5. Build for release

```sh
npm run build
```

`dist/` now holds:

- `nebula-1.0.0-setup.exe`: share this with Windows users. They double-click it and a setup wizard walks them through it ([NSIS](installer.md#building-it) must be installed where you build).
- `nebula-1.0.0-installer.zip`: for macOS (`Install Nebula.command`) and Linux (`./install.sh`).
- `nebula.user.js`: the web version, for userscript managers ([The web version](web.md)).
- `payload/`: what gets installed (used by `yapin-client install`).

## 6. Make the installer yours

Edit `installer/marketing.json`: title, tagline, logo, accent colour, features, screenshots, changelog, terms. Choose a preset in the config with `installer.preset`: `minimal`, `default` or `showcase`. See [The installer](installer.md).

## Next

- [How it works](architecture.md), so nothing about it is a mystery
- [Plugins](plugins.md) and [Themes](themes.md)
- [The client object](runtime.md)
