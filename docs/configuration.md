# Configuration

The config lives in `yapin-client.config.js` (or `.mjs`, or `.json`) at the root of your project:

```js
import { defineConfig } from 'yapin.js-client';

export default defineConfig({
  id: 'nebula',
  name: 'Nebula',
  // …
});
```

You can also export a function. It gets `{ mode }` (`'production'` or `'development'`):

```js
export default defineConfig(({ mode }) => ({
  id: 'nebula',
  runtime: { logLevel: mode === 'development' ? 'debug' : 'warn' },
}));
```

**Data, not code.** Most options reach the running client app, so they must be plain JSON: strings, numbers, booleans, arrays and objects, but no functions. The build stops and tells you which option is wrong. Code (badge providers with `get()`, custom validators, page render functions) belongs in your entry file.

Problems are reported together, and options that look like typos get a suggestion:

```text
✖ yapin-client.config.js:
  - version "1.0" must look like 1.2.3
  - settings.fn is a function; options that reach the client app must be plain data. Put code in your entry file instead
! Unknown option "plugns"; did you mean "plugins"?
```

## Identity

| Option | Default | |
| --- | --- | --- |
| `id` | from package.json `name` | Lowercase letters, digits and dashes. Names the data folder, storage keys and output files. Don't change it after release: people's settings are stored under it. |
| `name` | package.json `displayName` or `name` | Shown in settings, the About page and the installer. |
| `version` | package.json `version` | `1.2.3` (pre-release suffixes like `1.2.3-beta.1` are fine). |
| `description` | package.json `description` | |
| `authors` | package.json `author` | Strings or `{ name, url }`. |
| `links` | `{}` | https links for the About page and installer: `{ website, source, support, donate, … }`. The key becomes the label. |
| `icon` | none | A PNG or SVG. Used as the installer logo when the marketing config has none. |
| `entry` | none | Your code. Its default export runs as `setup(client)` before plugins start. |
| `origins` | Yapin’s origins | Pages the client app runs on. Only change this if Yapin’ moves. |
| `outDir` | `dist` | The build folder. The build only ever empties a folder it made itself. |
| `git` | `true` | Read branch, commit and remote for the About page. Credentials in the remote URL are removed. |

## `settings`

Your client app's own settings, as a [settings schema](settings.md). When there's at least one, a **Settings** page appears. Read them with `client.settings.get('key')`.

```js
settings: {
  compactMode: { type: 'switch', label: 'Compact mode', default: false },
  accent: { type: 'color', label: 'Accent', default: '#7c5cff' },
},
```

## `runtime`

| Option | Default | |
| --- | --- | --- |
| `logLevel` | `info` (`debug` in development) | `debug`, `info`, `warn`, `error` or `silent`. |
| `logColor` | `#7c5cff` | The colour of your log prefix in the console. |
| `exposeGlobal` | none (your id in camelCase in development) | Puts the client object on `window` under this name. Keep it off in production: anything on the page could use it. |

## `plugins`

| Option | Default | |
| --- | --- | --- |
| `dirs` | `['plugins']` | Folders with bundled plugins: `name.js`, or `name/index.js`. Names starting with `_` are skipped. |
| `enabled` | `{}` | Default on or off per plugin id, overriding a plugin's `enabledByDefault`. What the person chooses wins. |
| `required` | `[]` | Always on; the switch is disabled. |
| `hidden` | `[]` | Not shown on the Plugins page (they still run). |
| `blocked` | `[]` | Never load, for example a user plugin known to be harmful. |
| `crash.limit` / `crash.window` | `3` / `60000` | A plugin that fails this many times within this many ms is stopped for the session. |
| `user.enabled` | `true` | Allow people to install their own plugins. |
| `user.install.url` | `true` | Allow installing from a link. When false, people can still drop files in the folder (desktop). |
| `user.install.allowedHosts` | `[]` | Only allow links from these hosts (and their subdomains). Empty means any https host. |
| `user.install.maxBytes` | `1000000` | |

## `themes`

| Option | Default | |
| --- | --- | --- |
| `dirs` | `['themes']` | Folders with bundled `.css` themes. |
| `enabled` | `{}` | Default on or off per theme id. |
| `multiple` | `true` | `false` allows one theme at a time. |
| `css` | none | A CSS file that's always applied, your client app's own look. Safe mode turns it off too. |
| `variables` | none | Variables always applied: `{ '--accent': '#8b5cf6' }` or `{ dark: { … }, light: { … } }`. |
| `customCSS.enabled` | `true` | A Custom CSS box on the Themes page. |
| `customCSS.title`, `customCSS.description` | | Its heading and hint. |
| `user` | | Like `plugins.user`, with `maxBytes` 2000000. |

## `pages`

| Option | Default | |
| --- | --- | --- |
| `section` | your `name` | The label above your pages in the settings menu. |
| `position` | `end` | `start`, `end`, `before:<label>` or `after:<label>`, where `<label>` is one of Yapin’s nav labels (`after:User settings` puts your section before App settings). |
| `plugins` | `{ title: 'Plugins', order: 10 }` | The Plugins page; `false` removes it. Also `intro`, `emptyText` and `icon`. |
| `themes` | `{ title: 'Themes', order: 20 }` | The Themes page; `false` removes it. |
| `settings` | `{ title: 'Settings', order: 5 }` | Your settings page (only shown when `settings` isn't empty); `false` removes it. |

## `about`

`false` removes the About page. Otherwise:

| Option | | |
| --- | --- | --- |
| `title` | `About` | |
| `order` | `0` | |
| `intro` | none | A line under the heading. |
| `sections` | | `{ git: false }` hides a section; `{ support: { title: 'Support', order: 35 } }` adds one. |
| `fields` | | `{ 'git.remote': false }` hides a row; `{ 'support.email': { label: 'Email', value: 'help@example.com' } }` adds one. A string is a value. |
| `actions` | | `{ safeMode: false }` removes a button (`copy`, `folder`, `safeMode`). |

See [The About page](about-page.md) for every field id.

## `badges`

| Option | Default | |
| --- | --- | --- |
| `enabled` | `true` | |
| `sources` | `[]` | JSON badge files: `[{ id, url, refresh, priority, name }]`. Their origins are allowed automatically. |
| `slots` | profile and message | Where badges are drawn. `{ message: false }` turns one off; `{ profile: { size: 'lg' } }` changes one. |
| `max` | `6` | Badges per person. |
| `cache.ttl` | `15m` | How long one person's badges are remembered. |

See [Badges](badges.md).

## `api`

| Option | | |
| --- | --- | --- |
| `services` | `{}` | `{ name: { baseURL, headers, query, timeout, retries, cache, auth } }`. |
| `allowedOrigins` | `[]` | Extra origins `client.api` may reach. Service and badge source origins are added for you. |

See [API access](api.md).

## `host`

Overrides for the selectors and classes the framework uses to find its way around Yapin’s page. You only need this when Yapin’ changes its markup before the framework catches up. See [When Yapin’ changes](host-adapter.md).

```js
host: {
  selectors: { messageAuthor: '.msg-head .author-name' },
  userSettingsLabel: 'Your settings',
},
```

## `desktop`

| Option | Default | |
| --- | --- | --- |
| `csp` | `leave` | `relax` adds `blob:` to `script-src` if Yapin’ starts sending a Content-Security-Policy, so user plugins keep loading. Nothing else changes. See [Security](security.md#content-security-policy). |
| `devtools` | `true` | `false` closes devtools whenever they open. This is a speed bump, not protection. |
| `crashLimit` | `2` | Renderer crashes within a minute of loading before the next start is in safe mode. |

## `web`

| Option | Default | |
| --- | --- | --- |
| `userscript` | `true` | Build `dist/<id>.user.js`. |
| `namespace` | your source or website link | The userscript `@namespace`. |
| `updateURL`, `downloadURL` | none | Where userscript managers check for updates. |
| `matches` | your origins | `@match` patterns. |

## `installer`

| Option | Default | |
| --- | --- | --- |
| `preset` | `default` | `minimal`, `default` or `showcase`. |
| `marketing` | `{}` | An object, or a path to a JSON file (paths inside it are relative to that file). See [The installer](installer.md#marketing). |
| `target` | Yapin’s desktop app | Overrides for finding the app: `packageName`, `productName`, `executable`, `processName`, `locations` (per platform). |
| `closeApp` | `ask` | `ask`, `always` or `never` close Yapin’ when it's running. |
| `launchAfter` | `true` | Reopen Yapin’ after installing, if it was running. |
| `zip` | `true` | Build the installer zip. |
| `gui` | `true` | `false` makes the installer terminal-only. |
