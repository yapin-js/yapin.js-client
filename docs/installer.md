# The installer

`yapin-client build` makes installers for the people using your client app:

```text
dist/
  nebula-1.0.0-setup.exe        Windows: one file, double-click it
  nebula-1.0.0-installer.zip    macOS and Linux (the folder below, zipped)
  installer/nebula/
    Install Nebula.command      macOS: double-click
    install.sh                  Linux: ./install.sh
    installer.mjs               the installer itself
    installer.json              your installer settings, with images included
    payload/                    what gets installed
    README.txt
```

Share the `.exe` with Windows users and the zip with everyone else.

## No Node needed

Every launcher runs `installer.mjs` with the Node that's built into the Yapin’ desktop app (Electron's `ELECTRON_RUN_AS_NODE`), so anyone who has the desktop app can run the installer. If the desktop app isn't found, the launchers fall back to `node` when it's installed, and otherwise say the desktop app is missing.

## The Windows .exe

`<id>-<version>-setup.exe` is a small launcher (about 13 kB, written in C#) with the whole installer folder compressed onto its end. When someone runs it, it:

1. unpacks the installer into a new private folder in their temp directory;
2. finds the desktop app (the places in [Targets](#targets), plus any you add) and runs the installer with its Node, with no console window;
3. waits, then deletes the folder. If the installer fails, the error is shown in a message box.

It runs as the current user (no administrator prompt), like the per-user desktop app it installs into.

| Run as | Does |
| --- | --- |
| `nebula-setup.exe` | Opens the installer page in the browser. |
| `nebula-setup.exe install --yes` (or any command) | Runs that installer command with no window ([options](#in-the-terminal)). |
| `nebula-setup.exe --extract [--to <dir>]` | Unpacks the installer folder (next to the .exe by default), for running `installer.mjs --cli` yourself. |

### Name, version and icon

Built on Windows, the launcher is compiled for your client app with `csc.exe`, the C# compiler that comes with the .NET Framework on every Windows 10 and 11 machine. The .exe then shows your name, description, version and authors in its file properties, and your icon in Explorer and the taskbar. The icon is `installer.windows.icon`, or the config's `icon`: a PNG of at most 256×256 pixels, or an `.ico`.

Built on macOS or Linux, the .exe uses a prebuilt generic launcher instead (same behaviour, generic icon and details), and the build says so.

### Signing

Windows warns about unsigned programs from the internet ("Windows protected your PC"), and some antivirus programs are wary of unsigned installers. If you have a code signing certificate, have the build sign the .exe:

```js
installer: {
  windows: {
    sign: 'signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /a {file}',
  },
},
```

`{file}` is replaced with the .exe's path. Any signing tool works. The launcher finds its bundle with or without a signature.

### Options

| `installer.windows` | Default | |
| --- | --- | --- |
| `exe` | `true` | Build the .exe (it's skipped when `installer.gui` is false). |
| `fileName` | `<id>-<version>-setup.exe` | |
| `icon` | the config's `icon` | PNG (at most 256 px) or `.ico`. |
| `company` | your authors | Shown in the file's properties. |
| `sign` | none | A signing command containing `{file}`. |

## What it shows

By default the installer opens a page in the browser, served from the person's own computer, built from your marketing config. It lists the desktop installs it found, with each one's state:

| State | Shown as | Buttons |
| --- | --- | --- |
| clean | Not installed | Install |
| installed (yours) | Nebula 1.0.0 | Update (when the versions differ) or Repair, and Uninstall |
| needs repair | Needs repair | Repair, Uninstall |
| installed (another client app) | can't install | |
| foreign (another mod) | can't install | |
| integrity checking on | can't install | |

If Yapin’ is running, the page says so, and the installer closes it before changing anything. With `installer.closeApp: 'never'` it asks the person to close Yapin’ themselves instead. In the terminal, `ask` (the default) asks first and `always` doesn't. After installing, **Open Yapin’** starts it again.

Uninstalling offers to delete the person's installed plugins, themes and settings too. By default they're kept, so reinstalling later picks up where they left off.

The page stops (and the installer exits) when the tab is closed, or after 10 minutes if it was never opened.

### In the terminal

`installer.mjs --cli` (or any command) runs in the terminal instead, with the same branding:

```sh
./install.sh install --yes          # no questions
./install.sh uninstall --purge
./install.sh repair
./install.sh status
./install.sh --path "/opt/Yapper"   # when the app is somewhere unusual
```

| Option | |
| --- | --- |
| `--cli` | Terminal, with a menu when no command is given. |
| `--yes`, `-y` | Answer yes to everything. |
| `--close` | Close the desktop app without asking. |
| `--path <dir>` | Look here too (repeatable). |
| `--index <n>` | Which install, when there are several. |
| `--purge` | With `uninstall`: delete data too. |
| `--no-launch` | Don't reopen the desktop app afterwards. |

It also runs in the terminal automatically when there's no terminal attached (scripts, CI), or when `installer.gui` is false.

## Marketing

`installer.marketing` in the config is an object or (better) a path to a JSON file. Image paths in it are relative to the file, and get embedded in the installer at build time.

```json
{
  "title": "Nebula",
  "tagline": "Themes, plugins and a quieter Yapin’.",
  "description": "Nebula adds **themes**, **plugins** and an About page.\n\nSecond paragraph, with a [link](https://nebula.example).",
  "badge": "Beta",
  "logo": "../assets/logo.png",
  "accent": "#8b5cf6",
  "theme": "dark",
  "background": "radial-gradient(1200px 600px at 10% -10%, #2a1d52 0%, #121318 60%)",
  "features": [
    { "icon": "🎨", "title": "Themes", "text": "Pick a look, tweak colours live." },
    { "icon": "../assets/plug.svg", "title": "Plugins", "text": "Only what you want." }
  ],
  "screenshots": [{ "src": "../assets/shot1.png", "caption": "The Themes page" }],
  "changelog": [{ "version": "1.4.0", "date": "Oct 2026", "notes": ["Theme variables", "Faster startup"] }],
  "links": [{ "label": "Website", "url": "https://nebula.example" }],
  "terms": { "title": "License", "file": "../LICENSE", "requireAccept": true },
  "footer": "Made by Ada.",
  "css": "./installer.css",
  "strings": { "install": "Get Nebula" }
}
```

| Field | |
| --- | --- |
| `title`, `pageTitle` | The heading, and the browser tab title. |
| `tagline`, `description` | Text. `description` takes paragraphs (blank lines). Both allow `**bold**`, `*italic*`, `` `code` `` and `[links](https://…)`. |
| `badge` | A small tag after the title. |
| `logo`, `icon` | Image paths (or https/data URLs). `icon` is the tab icon (defaults to the logo). With no logo, the config's `icon` is used. |
| `accent` | A hex colour for buttons and links. |
| `theme` | `dark`, `light` or `auto` (follows the system). |
| `background` | A hex colour, a CSS gradient, or an image path. |
| `features` | `{ icon, title, text }`; `icon` is an emoji or an image path. Not shown with the `minimal` preset. |
| `screenshots` | Paths, or `{ src, caption }`. `showcase` preset only. |
| `changelog`, `changelogTitle` | `showcase` preset only. |
| `links` | Defaults to the config's `links`. https only. |
| `notice` | Text under the panel. Defaults to "Nebula is an unofficial modification of the Yapin’ desktop app. It isn’t made, supported or endorsed by Yapin’." Set `false` to remove it, but think twice. |
| `terms` | `{ title, text }` or `{ title, file }`. With `requireAccept` (the default when there's text), Install stays disabled until the box is ticked. |
| `panelTitle`, `footer` | |
| `css` | A CSS file added after the installer's own. The page uses CSS variables (`--accent`, `--bg`, `--panel`, `--panel-2`, `--text`, `--muted`, `--border`, `--radius`), so small changes are easy. |
| `strings` | Replace any text on the page (see `installerStrings` exported from the package for every key). `{name}`, `{version}` and `{product}` are filled in. |
| `lang` | The page's `lang` attribute. |

### Presets

| Preset | |
| --- | --- |
| `minimal` | Logo, name and tagline over one centred card. |
| `default` | A hero with the description, the feature grid, then the install panel. |
| `showcase` | `default` plus screenshots and a changelog. |

Every text is escaped, and only https and embedded images are allowed, so a mistake in the marketing file can't break the page.

## After Yapin’ updates

The desktop app updates itself by replacing its install folder, which removes the client app. After an update, Yapin’ starts plain, and the installer shows **Needs repair**. Repair puts the client app back on top of the new version, keeping the person's plugins, themes and settings. Tell your users to run the installer again after Yapin’ updates. The same setup `.exe` (or installer folder) works for repairs, so they can keep it.

`yapin-client repair` does the same from your project.

## Targets

The installer looks for the desktop app in the usual places:

| | |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Programs\yapper-desktop`, `%PROGRAMFILES%\Yapper` |
| macOS | `/Applications/Yapper.app`, `~/Applications/Yapper.app` |
| Linux | `/opt/Yapper`, `/opt/yapper-desktop`, `/usr/lib/yapper-desktop`, `/usr/share/yapper-desktop`, `~/.local/share/yapper-desktop` |

A folder only counts if its `app.asar` really is Yapin’ (package name `yapper-desktop`). If Yapin’ moves or renames things before the framework updates, override any of it:

```js
installer: {
  target: {
    locations: { win32: ['%LOCALAPPDATA%\\Programs\\yapin-desktop'] },
    processName: { win32: 'Yapin.exe' },
  },
},
```

Notes per platform:

- **Linux**: installs under `/opt` need `sudo ./install.sh`. AppImages are read-only and can't be patched.
- **macOS**: changing an app bundle invalidates its code signature. The app still starts, but macOS may ask the first time.
- Only one client app can be installed into a desktop app at a time, and the installer won't install over another mod. People must uninstall the other one first.

## Safety

- Before changing anything, the installer checks the app's Electron fuses, and refuses if asar integrity validation is on (installing would stop the app from starting).
- Every step can be undone: the original `app.asar` and its unpacked files are moved, never edited. If a step fails, the steps before it are rolled back.
- A lock file stops two installers working on one app at once.
- The installer page listens on `127.0.0.1` only, on a random port. Every action needs a random token that the browser gets in the URL fragment (never sent over the network, and removed from the address bar once read). Host and Origin headers are checked, so other websites can't drive it. The page has a strict Content-Security-Policy.
