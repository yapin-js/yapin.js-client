# Command line

```sh
npx yapin-client <command> [options]
```

Every command that needs your config finds `yapin-client.config.js` (or `.mjs`, `.json`) in the current folder; pass `-c <file>` to use another.

## init

```sh
npx yapin-client init [dir]
```

Creates a new client app in `dir` (default: the current folder): config, entry file, empty `plugins/` and `themes/`, installer marketing, `package.json` and `.gitignore`. It never overwrites files that are already there.

## build

```sh
npx yapin-client build [--mode development] [--no-installer]
```

Builds into `outDir` (default `dist/`): the payload, the Windows setup `.exe`, the installer folder and zip, and the userscript ([The installer](installer.md), [The web version](web.md)). `--no-installer` skips the installers, which is faster when you only need the payload.

The output folder is emptied first, but only if a previous build made it: the build leaves a marker file and refuses to empty a folder without one, or the project folder itself.

Development builds log more and put the client on `window` for devtools.

## dev

```sh
npx yapin-client dev [--close] [--path <dir>]
```

Builds in development mode, installs into the desktop app on this computer, and watches the project. On every save it rebuilds and reinstalls, and the desktop app reloads its window by itself. `--close` closes the desktop app if it's running (otherwise `dev` asks you to).

## install, uninstall, repair

```sh
npx yapin-client install [--close] [--path <dir>]
npx yapin-client uninstall [--purge] [--close]
npx yapin-client repair [--close]
```

The installer's operations, for the build in `dist/`, without the installer page. `repair` puts the client app back after a desktop update. `uninstall --purge` also deletes the client app's data folder.

## status

```sh
npx yapin-client status
```

Every desktop install found, its version, what's installed in it, and whether the desktop app is running. This works without a config too.

## pack

```sh
npx yapin-client pack src/my-plugin.js -o my-plugin.plugin.js
```

Bundles a plugin and everything it imports into a single file that people can install. The metadata header of the entry file is kept at the top.

## validate

```sh
npx yapin-client validate my-plugin.plugin.js
npx yapin-client validate midnight.theme.css
```

Checks a plugin or theme the way the runtime will: the header (`@id`, `@name`, `@version`, `@author`, `@apiVersion`), theme variables, balanced braces in CSS, and that a plugin bundles and compiles. Exits with 1 when there are problems.

A file named `*.plugin.js` or `*.theme.css` is taken to be one people install on its own, so its header has to be complete. Anything else is taken to be built into a client app, where the same things may live in the definition instead, and a thin header is only a warning.

The same check is `yapin-client plugin check <file>`.

## plugin

```sh
npx yapin-client plugin init my-plugin
npx yapin-client plugin dev
npx yapin-client plugin build --sign --key keys/mine.key --key-id ada
```

Everything for writing and sharing **one** plugin, rather than a whole client app: `init`, `build`, `dev`, `check`, `sign`, `verify`, `keygen` and `entry`. Run `yapin-client plugin --help` for the list, and see [Developing a plugin](plugin-development.md) for the whole workflow.

## doctor

```sh
npx yapin-client doctor
```

Checks the config, finds the desktop app, reports its fuses and install state, and checks whether Yapin’ has started sending a Content-Security-Policy. Run it first when something doesn't work.

## Options

| | |
| --- | --- |
| `-c, --config <file>` | The config file. |
| `--mode <mode>` | `production` (default) or `development`. |
| `--path <dir>` | Also look for the desktop app here (repeatable). |
| `--close` | Close the desktop app without asking. |
| `--purge` | With `uninstall`: delete data too. |
| `-o, --out <file>` | With `pack`, `plugin keygen`, `plugin entry`: where to write. |
| `--no-installer` | With `build`: skip the installer. |
| `--client <id>` | With `plugin dev`: which client app to install into. |
| `--manifest <file>` | With `plugin`: the manifest file. |
| `--key <file｜base64>` | With `plugin sign` / `verify`: the key. |
| `--key-id <name>` | With `plugin sign`: what to call the key. |
| `--sign` | With `plugin build`: sign the result. |
| `--json` | With `plugin check` / `entry`: machine-readable output. |
| `-h, --help`, `-v, --version` | |

Set `DEBUG=1` to see stack traces.

## From code

Everything the CLI does is exported:

```js
import { loadConfig, build, findInstalls, install } from 'yapin.js-client';

const { config, root } = await loadConfig();
const result = await build(config, { root, mode: 'production' });
const [app] = findInstalls();
install({ resources: app.resources, payload: result.payloadDir });
```

The types in `types/index.d.ts` list every function and option.
