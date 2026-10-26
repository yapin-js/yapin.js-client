# The client object

Your entry file's default export gets it:

```js
// src/index.js
export default async function setup(client) {
  // runs after bundled plugins and themes are registered, before plugins start
}
```

Plugins get it as `ctx.client`. Anywhere else in your bundled code:

```js
import { getClient } from 'yapin.js-client/runtime';
const client = getClient();   // null before startup
```

## Properties

| | |
| --- | --- |
| `id`, `name`, `version` | From your config. |
| `manifest` | Everything the build recorded (frozen): build time, git info, the config that reached the page. |
| `config` | The runtime part of your config (frozen). |
| `safeMode` | True when started in [safe mode](troubleshooting.md#safe-mode). |
| `environment` | `{ electron, chrome, node, os, platform }` on desktop; `{ userscript: true }` on the web. |
| `ready` | A promise that resolves when startup has finished. `isReady` is the same as a boolean. |
| `logger` | `debug`, `info`, `warn`, `error`, and `child(name)`. The last 300 entries are kept in `logger.history`. |
| `events` | [Events](#events). |
| `storage` | `storage.namespace(name)` → a [Store](settings.md#storage). |
| `settings` | Your client app's [settings](settings.md) (`settings` in the config). |
| `pages` | [Pages](pages.md). |
| `about` | [The About page](about-page.md) (null if you turned it off). |
| `plugins` | [Plugins](plugins.md). |
| `themes` | [Themes](themes.md). |
| `badges` | [Badges](badges.md). |
| `api`, `secrets` | [API access](api.md). |
| `ui` | [The UI kit](ui.md). |
| `userContent` | Installing and removing plugins and themes the person adds: `install(kind, { url })`, `uninstall(kind, id)`, `openFolder(kind)`, `allowed(kind)`. |
| `security` | What may be installed and who the person trusts: `trustsAuthors(authors)`, `trustAuthors(authors)`, `trustedAuthors()`, `forgetAuthor(name)`, `installs()`, and their own `settings`. See [Security](security.md#what-people-install-themselves). |
| `host` | What the framework knows about Yapin’s page ([below](#host)). |
| `dom` | `observe(selector, fn)` and `waitFor(selector, { timeout })` ([below](#watching-the-page)). |
| `styles` | `add(css, { id, order })` → `{ update(css), remove() }`. Plugins should use `ctx.css`, which cleans up. |
| `modules`, `patcher`, `react` | [Patching Yapin’](patching.md). |

## Methods

| | |
| --- | --- |
| `reportError(error, tags)` | Logs an error tagged with where it came from, and emits `error`. Never throws. |
| `openExternal(url)` | Opens an https or mailto link in the browser. |
| `stop()` | Stops plugins, removes styles, saves storage. For tests and reloads. |

## Events

```js
const off = client.events.on('plugin:start', (id) => {});
client.events.once('ready', () => {});
const [id] = await client.events.wait('page:open', { timeout: 5000, filter: (id) => id === 'about' });
off();
```

| Event | Arguments |
| --- | --- |
| `ready` | the client |
| `error` | the error (tagged with `plugin`, `theme`, `page` or `where`) |
| `settings:open`, `settings:close` | the nav element (open) |
| `page:add`, `page:remove`, `page:open`, `page:close` | page id |
| `plugin:add`, `plugin:update`, `plugin:remove`, `plugin:enable`, `plugin:disable`, `plugin:start`, `plugin:stop`, `plugin:install`, `plugin:uninstall` | plugin id |
| `plugin:error`, `plugin:crash` | plugin id, error |
| `theme:add`, `theme:update`, `theme:remove`, `theme:enable`, `theme:disable`, `theme:install`, `theme:uninstall` | theme id |
| `badges:update` | user id, or null for everyone |
| `security:authors` | the authors the person trusts, after a change |

You can emit your own events too. Plugins listen with `ctx.on(…)` or the `events` field, and those listeners go away when the plugin stops. A listener that throws is reported and doesn't stop the others.

## Watching the page

```js
const stop = client.dom.observe('.msg', (element) => {
  // called once for each .msg, now and as they appear
  return () => {};   // optional: called when that element leaves the page, or on stop()
});

const settingsNav = await client.dom.waitFor('nav.settings-nav', { timeout: 10_000 });   // null on timeout
```

One `MutationObserver` serves every watcher, and changes are handled in batches, so watching many selectors stays cheap.

## Host

`client.host` holds Yapin’-specific knowledge ([When Yapin’ changes](host-adapter.md)):

| | |
| --- | --- |
| `platform` | `'desktop'` or `'web'`. |
| `isDesktop` | |
| `desktop` | `window.yapperDesktop`, the desktop app's own bridge (badge count, notifications, hotkeys, activity), or null. |
| `desktopVersion` | The desktop app's version. |
| `colorScheme` | `'dark'` or `'light'`. |
| `onColorSchemeChange(fn)` | Returns a stop function. |
| `selectors`, `classes`, `config` | The selectors and classes in use. |
| `isUserSettings(nav)` | Whether a settings nav is the user settings one. |
| `className(...keys)` | Class names by key: `className('button', 'buttonSmall')` gives `'btn small'`. |

The desktop app's bridge is Yapin’s own API. It changes with Yapin’ releases, so check for each function before calling it:

```js
client.host.desktop?.onActivity?.((game) => client.logger.info('playing', game));
```

## Errors

Framework errors are `ClientError`s with a `code` from `ErrorCodes`:

`INVALID_DEFINITION`, `INVALID_SETTING`, `DUPLICATE_ID`, `NOT_FOUND`, `UNSUPPORTED`, `API_VERSION`, `DEPENDENCY`, `NOT_ALLOWED`, `REQUEST`, `TIMEOUT`, `STORAGE`, `LOAD_FAILED`.

Messages say what to do. API failures are `ApiError`s with `status` and `body` ([API access](api.md#results-and-errors)).
