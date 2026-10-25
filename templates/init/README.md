# __NAME__

A Yapin’ client app built with [yapin.js-client](https://github.com/yapin-js/yapin.js-client).

```sh
npm install
npm run dev      # build, install into the desktop app, rebuild when you save
npm run build    # dist/: setup .exe, installer zip, userscript and payload
```

- `yapin-client.config.js`: name, pages, plugin and theme options, installer.
- `src/index.js`: your code, run in the page before plugins start.
- `plugins/`: plugins built into __NAME__ (one `.js` file or folder each).
- `themes/`: themes built into __NAME__ (one `.css` file each).
- `installer/marketing.json`: what the installer page says and looks like.

Share `dist/__ID__-<version>-setup.exe` with Windows users, and `dist/__ID__-<version>-installer.zip` with macOS and Linux users.
