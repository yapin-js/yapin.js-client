# Changelog

## 0.1.0

The first release.

- **Runtime**: plugins (lifecycle, settings, dependencies, styles, observers, patches, pages, badges, crash limits, user installs), themes (metadata headers, `@var` settings, base styles, custom CSS, user installs), settings pages in Yapin’s user settings, an editable About page, badges with providers and slots, API services with an allowlist and secrets, a UI kit, a Turbopack module finder, a patcher and React prop helpers.
- **Desktop**: a main-process shim and sandboxed preload with a one-time native bridge, checked IPC, safe mode and crash-loop detection.
- **Build**: a zero-dependency ES module bundler, the payload, a userscript for the web version, and installers.
- **Installer**: a branded installer page (three presets, configured from JSON) and a terminal mode, running on the desktop app's own Node. Windows gets a single signable `setup.exe` with the app's icon and details; macOS and Linux get a zip. It installs, updates, repairs after desktop updates, and uninstalls, refusing to touch apps with asar integrity checks or other mods.
- **CLI**: `init`, `build`, `dev`, `install`, `uninstall`, `repair`, `status`, `pack`, `validate`, `doctor`.
