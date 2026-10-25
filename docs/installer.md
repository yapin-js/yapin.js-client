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

`<id>-<version>-setup.exe` is a setup wizard, the kind people know from other Windows programs. It's built with [NSIS](https://nsis.sourceforge.io) (the Nullsoft Scriptable Install System) and has its pages:

1. **Welcome**, with your logo down the side, your description and the "unofficial modification" notice.
2. **License**, when `marketing.terms` has text. With `requireAccept`, Next stays disabled until the box is ticked.
3. **Choose an option**: the desktop install it found (a list, when there are several) and what's there, then Install, Update, Reinstall or Repair, and Uninstall (with "Also delete my installed plugins, themes and settings"). Next is labelled with what it will do. If Yapin’ is open it says so, and asks before closing it (see `installer.closeApp`).
4. **Installing**, with a progress bar and **Show details** for each step. If something goes wrong, the error is shown and nothing is left half-done.
5. **Finish**, with **Open Yapin’** (ticked unless `installer.launchAfter` is false).

The wizard does the work with the same installer as everywhere else: it unpacks the installer folder to a temporary folder, runs it with the desktop app's Node (the places in [Targets](#targets), plus any you add) with no console window, and removes the folder when it closes. It runs as the current user (no administrator prompt), like the per-user desktop app it installs into.

| Run as | Does |
| --- | --- |
| `nebula-setup.exe` | Opens the wizard. |
| `nebula-setup.exe /S` | Silent: does what Next would (install, update, or repair) with no window. Exits with 0 when it worked. |
| `nebula-setup.exe /S /UNINSTALL [/PURGE]` | Silent uninstall; `/PURGE` also deletes installed plugins, themes and settings. |

The texts are in `marketing.strings` (the keys starting with `setup`, plus `install`, `launch`, `purge`, `accept` and the messages shared with the page), so they can be changed or translated.

### Pictures, name, version and icon

The side picture (164×314) is your `accent` colour with your logo on it, and the top-right picture (150×57) is your logo on white. The logo is `marketing.logo`, or the config's `icon`, as a PNG. To use your own pictures instead, set `installer.windows.sidebar` and `installer.windows.header` to `.bmp` files of those sizes.

The .exe shows your name, description, version and authors in its file properties, and your icon (`installer.windows.icon`, or the config's `icon`: a PNG of at most 256×256 pixels, or an `.ico`) in Explorer and the taskbar.

### Building it

Building the wizard needs NSIS 3 on the machine that runs `yapin-client build`. It's found in the usual install folders, on the `PATH`, in the `MAKENSIS` environment variable, or at `installer.windows.nsis` (a path to `makensis`).

| | |
| --- | --- |
| Windows | The installer from [nsis.sourceforge.io](https://nsis.sourceforge.io/Download), or `winget install NSIS.NSIS` |
| macOS | `brew install makensis` |
| Linux | `sudo apt install nsis` (or your distribution's `nsis` package) |

Without NSIS, the build still makes a `setup.exe`, the simpler kind: a small launcher (written in C#) that opens the [installer page](#what-it-shows) in the browser. The build warns when that happens. Set `installer.windows.nsis` to `false` to always make that kind. It takes commands too:

| Run as | Does |
| --- | --- |
| `nebula-setup.exe` | Opens the installer page in the browser. |
| `nebula-setup.exe install --yes` (or any command) | Runs that installer command with no window ([options](#in-the-terminal)). |
| `nebula-setup.exe --extract [--to <dir>]` | Unpacks the installer folder (next to the .exe by default), for running `installer.mjs --cli` yourself. |

Built on Windows, that launcher is compiled for your client app with `csc.exe`, the C# compiler that comes with the .NET Framework on every Windows 10 and 11 machine, so it has your name and icon. Built on macOS or Linux, it's a prebuilt generic launcher (same behaviour, generic icon and details).

### Signing

Windows warns about unsigned programs from the internet ("Windows protected your PC"), and some antivirus programs are wary of unsigned installers. If you have a code signing certificate, have the build sign the .exe:

```js
installer: {
  windows: {
    sign: 'signtool sign /fd sha256 /tr http://timestamp.digicert.com /td sha256 /a {file}',
  },
},
```

`{file}` is replaced with the .exe's path. Any signing tool works, for either kind of .exe.

### Options

| `installer.windows` | Default | |
| --- | --- | --- |
| `exe` | `true` | Build the .exe (it's skipped when `installer.gui` is false). |
| `nsis` | `true` | Build the wizard when NSIS is found. `false` for the browser launcher, or the path to `makensis`. |
| `fileName` | `<id>-<version>-setup.exe` | |
| `icon` | the config's `icon` | PNG (at most 256 px) or `.ico`. |
| `sidebar` | generated | A 164×314 `.bmp` for the Welcome and Finish pages. |
| `header` | generated | A 150×57 `.bmp` for the top of the other pages. |
| `company` | your authors | Shown in the file's properties. |
| `sign` | none | A signing command containing `{file}`. |

## What it shows

On macOS and Linux (and from the Windows browser launcher), the installer opens a page in the browser, served from the person's own computer, built from your marketing config. It lists the desktop installs it found, with each one's state:

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
