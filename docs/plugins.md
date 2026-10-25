# Plugins

A plugin is an object with an id and whatever it needs: settings, styles, event handlers, DOM observers, patches, a page, badges, and `start`/`stop` for anything else.

```js
import { definePlugin } from 'yapin.js-client/runtime';

export default definePlugin({
  id: 'unread-glow',
  name: 'Unread glow',
  description: 'Makes channels with unread messages glow.',
  version: '1.0.0',
  authors: [{ name: 'Ada', url: 'https://ada.dev' }],

  settings: {
    color: { type: 'color', label: 'Glow colour', default: '#ff6b4a' },
    strength: { type: 'slider', label: 'Strength', min: 1, max: 20, default: 8, unit: 'px' },
  },

  styles: ({ color, strength }) => `.rail-item.unread { box-shadow: 0 0 ${strength}px ${color}; }`,

  start(ctx) {
    ctx.logger.info('glowing');
  },
});
```

`definePlugin` returns the object unchanged. It's there for editor autocomplete.

## Where plugins come from

| Source | How | Who |
| --- | --- | --- |
| **bundled** | Files in your `plugins/` folder: `name.js` or `name/index.js`. Built into `runtime.js`. | You |
| **user** | Installed by the person using your client app: from a link on the Plugins page, or (desktop) a `.js` file dropped into the plugins folder. | Them |
| **code** | `client.plugins.add({ … })` from your entry file or another plugin. | You or plugin authors |

The framework ships none. People can't install a plugin with the same id as a bundled one.

## The definition

| Field | | |
| --- | --- | --- |
| `id` | required | Lowercase letters, digits and dashes. Stored settings are keyed by it, so keep it stable. |
| `name`, `description`, `version`, `authors`, `tags`, `website` | | Shown on the Plugins page. |
| `apiVersion` | current | The plugin API version it was written for. A plugin asking for a newer one than the framework has is shown as not compatible and never starts. |
| `minClientVersion` | | Needs at least this version of your client app. |
| `platforms` | both | `['desktop']` or `['web']` to limit where it runs. |
| `dependencies` | `[]` | Plugin ids that must run first. Enabling this plugin enables them; disabling one of them disables this. |
| `conflicts` | `[]` | Plugin ids that can't run at the same time. |
| `enabledByDefault` | `false` | On until the person turns it off. The config's `plugins.enabled` overrides it. |
| `required` | `false` | Bundled plugins only: always on. |
| `hidden` | `false` | Not shown on the Plugins page. |
| `settings` | | A [settings schema](settings.md). The Plugins page shows a form for it. |
| `styles` | | CSS while the plugin runs. A function gets the current settings and reruns when they change. |
| `events` | | `{ eventName(...args) {} }` for [client events](runtime.md#events). |
| `observe` | | `{ selector(element, ctx) {} }`, called for each matching element as it appears. Return a cleanup function if needed. |
| `patches` | | Declarative patches on Yapin’s modules ([below](#patches)). |
| `page` | | `{ title, render, icon, order }`: a settings page of the plugin's own, shown while it runs. |
| `badges` | | A [badge provider](badges.md) (or a list), active while the plugin runs. |
| `start(ctx)` | | Called when the plugin starts. May be async. |
| `stop(ctx)` | | Called when it stops. Usually not needed ([below](#cleanup)). |
| `onSettingsChange(key, value, ctx, old)` | | Called after a setting changes. |

## The context

`start(ctx)` and every handler get a `PluginContext`:

| | |
| --- | --- |
| `ctx.client` | The [client object](runtime.md). |
| `ctx.id`, `ctx.plugin` | The plugin's id and info. |
| `ctx.settings` | The plugin's [settings](settings.md): `get`, `set`, `onChange`. |
| `ctx.storage` | Saved data for the plugin (separate from settings): `get`, `set`, `delete`, `keys`. |
| `ctx.logger` | Logs prefixed with the plugin's id. |
| `ctx.ui`, `ctx.h` | The [UI kit](ui.md) and the element builder. |
| `ctx.css(text)` | Adds CSS; returns `{ update(css), remove() }`. |
| `ctx.observe(selector, fn)` | Like `observe` above. |
| `ctx.on(event, fn)` | A client event listener. |
| `ctx.listen(target, type, fn)` | `addEventListener`. |
| `ctx.setTimeout`, `ctx.setInterval` | Timers. |
| `ctx.patch.before / after / instead` | [Patch](patching.md) a function. |
| `ctx.pages.add(def)` | Add a [page](pages.md). |
| `ctx.badges.addProvider(def)`, `ctx.badges.add(userId, badge)` | Add [badges](badges.md). |
| `ctx.themes.add(def)` | Add a [theme](themes.md) from code. |
| `ctx.modules`, `ctx.react`, `ctx.host` | [Finding Yapin’s modules, reading React props, selectors](patching.md). |
| `ctx.api` | [API access](api.md). |
| `ctx.onStop(fn)` | Run something when the plugin stops. |
| `ctx.toast(message, options)` | Show a toast. |

### Cleanup

Everything registered through `ctx` is undone when the plugin stops: styles, observers, listeners, timers, patches, pages, badges and themes. Most plugins never need `stop()`. Use `ctx.onStop(fn)` for anything else.

```js
start(ctx) {
  ctx.observe('.msg-text', (element) => {
    element.classList.add('fancy');
    return () => element.classList.remove('fancy');   // runs when the element leaves, or the plugin stops
  });
  ctx.setInterval(() => ctx.logger.debug('still here'), 60_000);
},
```

## Lifecycle

```
stopped → starting → running → stopped
                   ↘ error (start threw)
           running → crashed (failed too often)
incompatible (never starts)
```

- Enabled plugins start once Yapin’ has loaded, dependencies first.
- Turning a plugin on or off on the Plugins page starts or stops it immediately and remembers the choice.
- If `start` throws, everything it registered is undone and the plugin shows the error.
- Every handler is guarded. An error is logged with the plugin's id, and the rest of the client app carries on. A plugin that fails `crash.limit` times (3) within `crash.window` ms (one minute) is stopped for the session, and the person sees a toast.
- In [safe mode](troubleshooting.md#safe-mode), no plugins start.

From code:

```js
await client.plugins.enable('unread-glow');   // starts it and remembers
await client.plugins.disable('unread-glow');
client.plugins.isRunning('unread-glow');
client.plugins.info('unread-glow');           // { status, enabled, error, … }
client.plugins.get('unread-glow').settings.set('strength', 12);
```

## Patches

The declarative form waits for and validates its target:

```js
patches: [
  {
    find: { props: ['sendMessage', 'editMessage'] },   // or { code: ['unique string'] }, or (modules) => target
    method: 'sendMessage',
    wait: true,          // wait for the module to load (default timeout 15 s)
    optional: true,      // warn instead of failing the plugin if it isn't found
    before(args, thisArg, ctx) {
      args[1] = args[1].replace(/:shrug:/g, '¯\\_(ツ)_/¯');
    },
  },
],
```

See [Patching Yapin’](patching.md) before patching anything. Yapin’ deploys often, and patches are the first thing to break.

## User plugins

People can install plugins from the Plugins page (**Install from link**) or, on desktop, by putting a file in the plugins folder (**Open folder** on the Plugins page). Before anything runs, the installer shows the plugin's name, version, author and source, warns that plugins have full access, and asks.

A user plugin is one ES module file. It can't import other files, but it can import from URLs with `import()`. Give it a metadata header so it can be shown before it's loaded:

```js
/**
 * @id quick-react
 * @name Quick react
 * @description Double-click a message to react with 👍.
 * @version 1.0.0
 * @author Ada <https://ada.dev>
 * @apiVersion 1
 */
export default {
  start(ctx) {
    ctx.observe('.msg', (msg) => {
      const onDouble = () => ctx.toast('👍');
      msg.addEventListener('dblclick', onDouble);
      return () => msg.removeEventListener('dblclick', onDouble);
    });
  },
};
```

The default export can also be a function that receives the client and returns the definition. The header fills in anything the definition leaves out.

On desktop, editing a file in the plugins folder reloads that plugin straight away.

To write a user plugin across several files, bundle it into one with:

```sh
npx yapin-client pack src/my-plugin.js -o my-plugin.plugin.js
```

Check a plugin or theme file before sharing it:

```sh
npx yapin-client validate my-plugin.plugin.js
```

## Bundled plugins can import

Bundled plugins are built with your client app, so they can import other files, JSON, and `.css`, `.svg`, `.txt`, `.html` or `.md` (as text):

```js
import css from './style.css';
import icon from './icon.svg';
import { helper } from '../shared/helper.js';

export default { id: 'with-assets', styles: css, page: { title: 'With assets', icon, render() {} } };
```

The bundler follows the ES module rules, with three exceptions it reports clearly: circular imports, top-level `await`, and CommonJS packages.
