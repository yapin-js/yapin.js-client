# yapin.js-client

A framework for building client apps for [Yapin’](https://www.yapin.gg): modified versions of the Yapin’ desktop app (and the web app, as a userscript) with your own pages, themes, plugins and badges.

It's a framework, not a finished client. It provides the plumbing, so your client app only has to describe what makes it different:

- **Plugins.** A full lifecycle with typed settings, dependencies, styles, DOM observers, patches and pages. Everything a plugin registers is undone automatically when it stops, and a plugin that keeps crashing is switched off on its own. Your users can install their own plugins, if you allow it.
- **Themes.** CSS files with a metadata header. `@var` declarations become colour pickers and sliders in settings. There are also base styles, custom CSS, and themes added from code.
- **Settings pages.** Add a page to Yapin’s own settings menu with one call. It looks native and leaves Yapin’s React tree untouched.
- **An About page.** Version, build, git commit and environment, out of the box. Every row can be edited, hidden or removed, and so can the whole page.
- **Badges.** Next to names on profile cards and messages, from a JSON file, your API, or code. Every badge is sanitised.
- **API access.** Named services with retries, caching and secrets stored in the operating system's key store. On desktop, requests go through the main process, checked against an allowlist that's fixed at build time.
- **A branded installer.** A single `setup.exe` on Windows (your icon, name and version, signable), a zip for macOS and Linux. Configured from a JSON file with three presets. It runs on the Node built into the desktop app, so the people installing need nothing else. It handles install, update, repair after desktop updates, and uninstall.
- **Zero dependencies.** It includes its own bundler, asar reader and writer, zip writer and test suite.

> Client apps modify Yapin’. Check Yapin’s terms before you publish one, and make clear that yours is unofficial (the installer says so by default).

## Quick start

```sh
npx yapin.js-client init my-client
cd my-client
npm install
npm run dev
```

`npm run dev` builds your client app, installs it into the Yapin’ desktop app on your computer, and rebuilds and reloads every time you save. Open Yapin’, go to **Settings**, and your pages are at the bottom of the menu.

`npm run build` produces everything you need to publish:

| File | What it is |
| --- | --- |
| `dist/<id>-<version>-setup.exe` | The Windows installer: one file to share. |
| `dist/<id>-<version>-installer.zip` | The installer for macOS and Linux. |
| `dist/<id>.user.js` | The web version, for Tampermonkey or Violentmonkey. |
| `dist/payload/` | What gets installed. |

## What a client app looks like

```text
my-client/
  yapin-client.config.js     name, options, installer
  src/index.js               your code (runs in the page)
  plugins/                   plugins built into your client app
  themes/                    themes built into your client app
  installer/marketing.json   what the installer page says
```

```js
// src/index.js
export default function setup(client) {
  client.pages.add({
    id: 'changelog',
    title: 'Changelog',
    render(root, { ui }) {
      root.append(ui.heading('Changelog'), ui.hint('What changed in this version.'));
    },
  });

  client.about.set('support.discord', { label: 'Community', value: 'https://example.com/chat', href: 'https://example.com/chat' });

  client.badges.addProvider({ id: 'supporters', url: 'https://api.example.com/badges.json', refresh: '30m' });
}
```

```js
// plugins/compact.js
import { definePlugin } from 'yapin.js-client/runtime';

export default definePlugin({
  id: 'compact',
  name: 'Compact messages',
  description: 'Less space between messages.',
  settings: { gap: { type: 'slider', label: 'Gap', min: 0, max: 16, default: 4, unit: 'px' } },
  styles: ({ gap }) => `.msg { margin-top: ${gap}px; }`,
});
```

## Documentation

Start with [Getting started](docs/getting-started.md), then [How it works](docs/architecture.md). Everything else is listed in [docs/](docs/README.md).

## Requirements

- Node 18.17 or newer to build. People installing your client app don't need Node.
- The Yapin’ desktop app (Windows, macOS or Linux), or a userscript manager for the web version.

## Testing

```sh
npm test               # offline: bundler, installer, runtime, build
npm run test:browser   # needs Chrome or Edge: settings pages, badges, forms in a real browser
```

## License

MIT
