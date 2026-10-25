# How it works

The Yapin’ desktop app is an Electron app whose window loads the Yapin’ website (`https://www.yapper.website`). A client app gets in at three points: the app's main process, a preload script, and the page itself. The web version skips the first two.

```
Yapper.exe
 └─ resources/app.asar ............ the stub, written by the installer
     ├─ loads <data>/app/shim.cjs .. your client app's main-process part
     └─ then loads _app.asar ....... the original Yapin’ app, unchanged
          └─ BrowserWindow → https://www.yapper.website
               ├─ Yapin’s own preload (window.yapperDesktop)
               └─ preload.cjs ...... registered by the shim; injects runtime.js
                    └─ runtime.js .. your client app in the page
```

## The installer and the stub

The installer finds the desktop app's `resources` folder and:

1. copies your built payload to `<appData>/yapin-client/<id>/app/`;
2. renames `app.asar` to `_app.asar`, and `app.asar.unpacked` to `_app.asar.unpacked` (the original app's native modules live there and must move with it);
3. writes a new `app.asar`, the stub. It contains three files:
   - `package.json`, copied from the original app's name, product name and version, so Electron keeps using the same user data folder and nobody gets logged out;
   - `index.js`, which loads your shim, then the original app;
   - `yapin-client.json`, a marker saying which client app is installed and where its files are.

The stub never lets a broken client app stop Yapin’ from opening. If the shim is missing or throws, the stub logs the error and loads Yapin’ anyway. Setting `YAPIN_CLIENT_DISABLE=1`, or starting with `--yc-disable`, skips the client app entirely.

Before touching anything, the installer reads the desktop app's [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses). If Yapin’ ever turns on asar integrity validation, a changed `app.asar` won't start, so the installer refuses instead of breaking the app.

### When Yapin’ updates

The desktop app updates itself with electron-updater, which replaces the install folder, stub included. After an update, Yapin’ starts without your client app until someone runs the installer again and chooses **Repair** (or `yapin-client repair`). The installer recognises this state ("needs repair") and puts the client app back over the new version. Installed plugins, themes and settings live in the data folder, so nothing is lost. See [The installer](installer.md#after-yapin-updates).

## The main process: shim.cjs

The shim runs before Yapin’s own `main.js`. It:

- checks `runtime.js` against the hash in `manifest.json` and won't load a damaged or edited one;
- decides whether to start in [safe mode](troubleshooting.md#safe-mode);
- registers the preload for every Yapin’ page, alongside Yapin’s own (which keeps working);
- answers the preload's requests: storage, user plugin and theme files, API requests, secrets, opening folders and links, relaunching;
- watches the user plugin and theme folders and tells the page when a file changes;
- counts renderer crashes, so a crash loop leads to safe mode on the next start.

Every request is checked. It must come from the main frame of a page on one of your `origins`. File names are validated and kept inside their folder. API requests go only to origins on the allowlist that was fixed when you built the client app. See [Security](security.md).

## The preload: preload.cjs

The preload runs in every Yapin’ page before the page's own scripts. It's sandboxed and context-isolated, like Yapin’s own preload. It:

1. asks the main process for the runtime and a snapshot of what it needs (storage, installed plugins and themes);
2. offers the runtime a native bridge, behind a `claim()` that works once;
3. injects `runtime.js` into the page.

The runtime claims the bridge immediately, before any page script runs. Anything that asks later gets nothing, so scripts on the page can't use the bridge to write files or read secrets.

## The page: runtime.js

`runtime.js` is your client app, bundled: the framework's runtime, your entry file, and your plugins and themes. On start it:

1. hooks Turbopack (Yapin’s bundler) before the page's first script, so [Yapin’s modules can be found](patching.md);
2. applies the framework's styles, your base styles and the enabled themes (no flash of the plain app);
3. registers bundled themes and plugins and the built-in pages (About, Plugins, Themes, Settings);
4. runs your entry file's `setup(client)`;
5. loads the plugins and themes the person installed;
6. once the page has a body, starts drawing pages into the settings menu and badges into profiles and messages;
7. starts the enabled plugins, dependencies first;
8. emits `ready`.

Nothing here touches Yapin’s React state. Pages are drawn into a sibling of Yapin’s settings section, badges are inserted next to elements, and styles use `adoptedStyleSheets`. When Yapin’ re-renders, the framework notices and redraws its own parts.

## The web version

The userscript build is the same `runtime.js` with a userscript header. It runs at `document-start`, before Yapin’s scripts. It has no native bridge, so:

- storage is `localStorage`;
- people install plugins and themes by link, not by file;
- API requests go straight from the page, so your API needs CORS;
- secrets aren't encrypted.

See [The web version](web.md).

## Where things live on disk

```
<appData>/yapin-client/<id>/
  app/            the installed payload (replaced on every install or update)
  plugins/        plugins the person installed (*.plugin.js)
  themes/         themes the person installed (*.theme.css)
  storage/        saved settings and data, one JSON file per namespace
  secrets.json    secrets, encrypted with the OS key store
  logs/main.log   the main process's log
  state.json      safe mode and crash counting
  install.json    where it was installed
```

`<appData>` is `%APPDATA%` on Windows, `~/Library/Application Support` on macOS and `$XDG_CONFIG_HOME` (or `~/.config`) on Linux.
