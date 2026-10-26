# Developing a plugin

This is for writing **one plugin** and sharing it with people who already use a Yapin’ client app. If
you're building the client app itself, start with [Getting started](getting-started.md) and put your
plugins in its `plugins/` folder instead — see [Plugins](plugins.md).

A shared plugin is a single ES module file with a metadata header: `my-plugin.plugin.js`. People
install it from the Plugins page (**Install from link**) or by dropping it in their client app's
plugins folder. You write a normal project with as many files as you like; the build bundles it into
that one file.

## Start a project

```sh
npx yapin-client plugin init my-plugin
cd my-plugin
npm install
```

That gives you:

```
yapin-plugin.json   id, name, version, author, compatibility
src/index.js        your plugin
```

Set `client` in `yapin-plugin.json` to the id of the client app you're testing in, then:

```sh
npm run dev
```

This builds your plugin straight into that client app's plugins folder and rebuilds whenever you
save. The desktop app watches that folder and reloads the plugin itself, so there's nothing to
restart — keep the Plugins page open and watch it reload.

## The manifest

`yapin-plugin.json` is the one place your plugin's identity lives. The build turns it into the
metadata header of the built file, so the two can't drift apart.

```jsonc
{
  "id": "quick-react",                 // lowercase letters, digits and dashes
  "name": "Quick react",
  "description": "Double-click a message to react with 👍.",
  "version": "1.0.0",                  // 1.2.3; update checks compare it
  "authors": ["Ada <https://ada.dev>"],
  "license": "MIT",
  "website": "https://github.com/ada/quick-react",

  "apiVersion": 1,                     // the plugin API you wrote against
  "minClientVersion": "0.1.5",         // the oldest framework version this works on
  "platforms": ["win32", "darwin"],    // leave out to run anywhere

  "tags": ["messages"],
  "dependencies": [],                  // ids of plugins that must be running
  "conflicts": [],                     // ids that must not be

  "updateUrl": "https://ada.dev/quick-react.plugin.js",

  "entry": "src/index.js",
  "outDir": "dist",
  "client": "showcase-client"          // which client app `plugin dev` installs into
}
```

`id`, `name`, `version` and `authors` are required: a client shows them to the person **before it runs
any of your code**, which is the whole reason the header exists.

`apiVersion` is refused if it's newer than the framework's, and `minClientVersion` and `platforms` let
a client refuse your plugin cleanly instead of failing halfway through `start()`.

## Writing the plugin

`src/index.js` default-exports the definition. Everything you need is on `ctx` — see
[Plugins](plugins.md) for the full list and [The client object](runtime.md) for what sits behind it.

```js
import { definePlugin } from 'yapin.js-client/runtime';

export default definePlugin({
  settings: {
    emoji: { type: 'text', label: 'Emoji', default: '👍' },
  },

  start(ctx) {
    ctx.observe('.msg', (msg) => {
      const react = () => ctx.toast(ctx.settings.get('emoji'));
      msg.addEventListener('dblclick', react);
      return () => msg.removeEventListener('dblclick', react);
    });
  },
});
```

Don't repeat `id`, `name` or `version` here — they come from the manifest.

Import whatever you like from your own files; it all gets bundled. From
`yapin.js-client/runtime` you get only `definePlugin`, `defineTheme`, `definePage`,
`defineBadgeProvider`, `apiVersion` and `version`. That's deliberate: a plugin people download
shouldn't ship a second copy of the runtime the client already has. Everything else is on `ctx`
(`ctx.h`, `ctx.ui`, `ctx.api`, `ctx.modules`, `ctx.patch`), and `plugin check` tells you if you reach
for something that won't be there.

The bundler follows the ES module rules with three exceptions it reports clearly: circular imports,
top-level `await`, and CommonJS packages.

## Build and check

```sh
npm run build     # dist/<id>.plugin.js, and its sha256
npm run check     # the manifest, the header and the code
```

`plugin check` is what to run before sharing anything. It checks what a client checks, plus what a
reviewer would otherwise have to catch by hand: a missing default export, metadata the header needs,
a `version` too loose to compare, imports that won't resolve in a client, and code loaded from a URL
at runtime.

`plugin check <file>` checks one `.js` or `.css` file instead, so it works on files other people sent
you. `--json` prints the result for CI.

## Sharing it

Give people `dist/<id>.plugin.js`. Put it anywhere over https and set `updateUrl` in the manifest to
that address, and clients can compare their copy's `@version` with yours and offer the update.

Changing `id` makes it a different plugin, and people keep their settings per id — so don't.

## Signing

A signature lets someone check that the file they downloaded is exactly the one you built, and that
nobody edited the name, author or code on the way. It covers the header too, which matters: without a
signature, the name and author a client shows before installing are whatever the file claims.

```sh
npx yapin-client plugin keygen -o keys/mine.key      # mine.key (secret) and mine.key.pub
npx yapin-client plugin build --sign --key keys/mine.key --key-id ada
npx yapin-client plugin verify dist/my-plugin.plugin.js --key keys/mine.key.pub
```

Signing adds one line to the header:

```
 * @signature ed25519 ada N4MM7gOfqbW5ulIRh9URSBCUhK/…
```

The private key is your whole identity as a publisher. Keep it out of git (the scaffold's
`.gitignore` already covers `*.key`) and keep it in a secret in CI.

**What a signature does not mean.** It says the file is what the key's holder signed. It says nothing
about what the code does, and a signed plugin can still load unsigned code at runtime with
`import('https://…')`. Whether a client app treats a given key as "verified" is that client app's
decision, not yours and not this framework's — a signature nobody has chosen to trust is just a
checksum with a name on it.

### What is signed, exactly

Frozen, because changing it would invalidate every signature ever issued:

1. The file's text, with line endings normalised to `\n` (so an editor rewriting CRLF doesn't break it).
2. The `@signature` line removed from the metadata header.
3. Encoded UTF-8.

That's `canonicalText()` in `src/runtime/meta.js`, signed with Ed25519 and base64-encoded. There is no
`@integrity` tag, because a file can't contain its own hash — the hash belongs in whatever index points
at the file. `plugin entry` prints that entry, including the `sha256`:

```sh
npx yapin-client plugin entry -o entry.json
```

## Commands

| | |
| --- | --- |
| `plugin init [dir]` | Start a project |
| `plugin build` | Bundle into `dist/<id>.plugin.js` (`--sign` to sign it) |
| `plugin dev` | Build into a client app's plugins folder, rebuild on save |
| `plugin check [file]` | Check the project, or one file (`--json` for CI) |
| `plugin sign <file>` | Add an `@signature` line |
| `plugin verify <file>` | Check a signature against a public key |
| `plugin keygen` | Make a signing key pair |
| `plugin entry` | Print the index entry for this plugin |

Options: `--client <id>`, `--key <file｜base64>`, `--key-id <name>`, `--sign`, `--json`,
`-o, --out <file>`, `--manifest <file>`.

Everything the CLI does is also exported from `yapin.js-client`, so a build script can call
`loadManifest`, `buildPlugin`, `checkFile`, `signText` and `verifyText` directly.

## Before you share

- `plugin check` passes.
- The version went up, and `updateUrl` points at where you actually host the file.
- `start()` registers everything through `ctx`, so stopping the plugin undoes it. Most plugins need no
  `stop()` at all — see [Cleanup](plugins.md#cleanup).
- If you patch Yapin’, read [Patching Yapin’](patching.md) first. Patches are the first thing to break
  when Yapin’ deploys, and `optional: true` is usually better than a plugin that refuses to start.
- Your plugin runs with full access to Yapin’ in that window, including the person's account. People
  are told that before they install. Be worth the trust.
