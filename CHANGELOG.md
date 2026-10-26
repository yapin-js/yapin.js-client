# Changelog

## 0.1.4

- **About page**: a cleaner, more compact layout: a header card (logo tile, name, version tag with a copy icon, description), a row of buttons with icons, and the other sections as small cards in a grid, with links as chips. Each section's look is its `layout` (`rows`, `chips` or `header`), changeable from the config or with `client.about.section(id, { layout })`; `about.logo` sets the header tile, actions take an `icon`, and `client.about.sections()` lists the sections. The Plugins and Themes pages get nav icons by default.

- **Desktop**: fixed the client app freezing Yapin’ on start ("Yapin’ is taking too long to load", with no keyboard shortcuts working). The preload's injected script evaluated to the `Client` object, which `executeJavaScript` then tried to convert back to the preload; that object reaches `window` and the whole DOM, so the page hung before it finished loading. The script now evaluates to `undefined`.
- **UI kit**: icons given as SVG markup without `xmlns` (the built-in icon set included) parsed as plain XML elements and drew nothing. `ui.svg()` and `ui.icon()` now add the SVG namespace when it's missing.
- **Runtime**: a failure in the welcome or what's new screen is reported instead of stopping the client app from finishing start-up.
- **Desktop**: `main.log` now records each page load, how long it took to reach `dom-ready`, load failures, preload errors and page errors, so a page that never loads can be diagnosed from the log alone.

## 0.1.3

- **Installer**: fixed a crash in the Windows setup wizard when the target desktop app is already installed. The wizard runs the installer through the desktop app's own Node (`ELECTRON_RUN_AS_NODE`), which means the installer's own process shares the app's executable name; closing the app before install used to kill every process with that name, including the installer itself, mid-operation ("The installer stopped with an error", with no further detail). Closing the app is now done by PID, always excluding the installer's own process.

## 0.1.2

- **Runtime**: a rounded, animated welcome screen for a client app's first run, and a what's new screen shown once after an update with something to say. Both are entirely optional (`welcome: false` / `whatsNew: false`), editable from the config (icon, title, subtitle, steps/entries, labels), and replayable any time with `client.welcome.show()` / `client.whatsNew.show()`. A matching button is added to the About page automatically.
- **UI kit**: a small built-in icon set, usable by name (`icon: 'rocket'`) anywhere an icon is accepted — pages, the About page, cards, buttons, the new welcome/what's new screens. Toasts and `confirm()` dialogs now show a matching icon automatically.
- **Installer**: the Windows `setup.exe` is now a setup wizard built with NSIS (Welcome, License, a page to choose Install, Update, Repair or Uninstall, progress with Show details, and Finish with Open Yapin’), branded with the logo and accent colour, and scriptable with `/S`, `/UNINSTALL` and `/PURGE`. Building it needs NSIS; without it, the build makes the browser launcher as before. New options: `installer.windows.nsis`, `sidebar` and `header`, and `setup*` strings.

## 0.1.0

The first release.

- **Runtime**: plugins (lifecycle, settings, dependencies, styles, observers, patches, pages, badges, crash limits, user installs), themes (metadata headers, `@var` settings, base styles, custom CSS, user installs), settings pages in Yapin’s user settings, an editable About page, badges with providers and slots, API services with an allowlist and secrets, a UI kit, a Turbopack module finder, a patcher and React prop helpers.
- **Desktop**: a main-process shim and sandboxed preload with a one-time native bridge, checked IPC, safe mode and crash-loop detection.
- **Build**: a zero-dependency ES module bundler, the payload, a userscript for the web version, and installers.
- **Installer**: a branded installer page (three presets, configured from JSON) and a terminal mode, running on the desktop app's own Node. Windows gets a single signable `setup.exe` with the app's icon and details; macOS and Linux get a zip. It installs, updates, repairs after desktop updates, and uninstalls, refusing to touch apps with asar integrity checks or other mods.
- **CLI**: `init`, `build`, `dev`, `install`, `uninstall`, `repair`, `status`, `pack`, `validate`, `doctor`.
