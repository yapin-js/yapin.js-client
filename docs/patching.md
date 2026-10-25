# Patching Yapin’

Most client apps never need this: pages, themes, badges and DOM observers cover a lot. When you do need to change how Yapin’ behaves, the framework can find Yapin’s own modules, wrap their functions, and read React's props off elements.

**Read this first.** Yapin’ deploys often, and every deploy renames its internals. A patch that works today can find nothing tomorrow. Write patches to fail softly (`optional: true`, null checks), and expect to update them.

## Finding modules

Yapin’s web app is built with Turbopack. The runtime hooks it before Yapin’s first script runs, so it sees every module the app loads. `client.modules` (or `ctx.modules`) searches them:

```js
const store = client.modules.findByProps('getState', 'setState', 'subscribe');   // has all of these
const fn = client.modules.findByCode('settingsAt', 'open');                      // a function whose source contains these
const exp = client.modules.findModuleByCode('unique string');                    // a module whose code contains it
const all = client.modules.findAll((e) => typeof e === 'function' && e.length === 3);
const later = await client.modules.waitFor(client.modules.filters.byProps('sendMessage'), { timeout: 15_000 });
const lazy = client.modules.lazy(client.modules.filters.byName('MessageList'));   // finds on first call
```

- Search by what a module looks like (its exports, or text in its code), never by id. Ids change on every deploy.
- `find` checks each module's exports and each of its named exports (`deep: true`, the default).
- Everything can return null. Check before you use it.
- `client.modules.available` is true once the module cache has been seen. On the web, a userscript that runs late still finds everything as soon as any new module loads (opening settings does it).
- Searching is linear in the number of modules. Find once and keep the result, rather than searching in a loop.

The filters are in `client.modules.filters` (also exported as `filters`): `byProps(...props)`, `byCode(...strings)`, `byName(name)`.

## Patching functions

```js
const unpatch = ctx.patch.after(store, 'getState', (args, result) => {
  // return something to replace the result; return nothing to keep it
});

ctx.patch.before(api, 'send', (args) => {
  args[0] = args[0].trim();            // change args in place…
  // …or return a new array to replace them
});

ctx.patch.instead(api, 'send', (args, original) => {
  if (shouldBlock(args)) return null;
  return original(...args);
});
```

Any number of patches can sit on one function, from any number of plugins, and they can be removed in any order. When the last one goes, the original is put back. A patch that throws is reported (tagged with the plugin) and skipped, so the function keeps working. Plugin patches are removed when the plugin stops. Outside plugins, use `client.patcher` and keep the unpatch function.

The wrapper keeps the original's `name`, `length` and `toString()`, so `findByCode` still finds patched functions.

The [declarative form](plugins.md#patches) in a plugin definition adds waiting and "optional" handling for you.

## Reading React props

Yapin’ draws with React. React keeps each component's props on the DOM elements it renders, and the framework can read them (read-only):

```js
client.react.findUserId(element);                         // the user id a piece of the page belongs to
client.react.findValue(element, ['message.id', 'messageId']);
client.react.findProps(element, (props) => 'channelId' in props);   // the first matching props, walking up
client.react.propsOf(element);                            // the props of the element itself
client.react.fiberOf(element);                            // React's internal fiber
```

These walk up through parent components (40 levels by default, `{ maxDepth }` to change it). This is how [badges](badges.md#finding-whose-name-it-is) know whose name they're next to.

Don't change props or state you find this way. React won't know, and Yapin’ will behave strangely.

## Being a good citizen

- Prefer CSS, `observe` and pages to patches. They break less, and they break visibly.
- Patch the narrowest thing you can.
- Make patches optional unless the plugin is useless without them, and tell the person when one can't be applied.
- Never patch anything to do with authentication, payments or account security, and never use Yapin’s internals to automate accounts. That breaks Yapin’s terms, and it's how client mods get people banned.
