# The web version

Every build also makes `dist/<id>.user.js`: your whole client app as a userscript, for Tampermonkey, Violentmonkey and other userscript managers. It runs on Yapin’ in any Chromium or Firefox browser.

```js
// ==UserScript==
// @name         Nebula
// @namespace    https://github.com/ada/nebula
// @version      1.4.0
// @match        https://www.yapper.website/*
// @match        https://www.yapin.gg/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
```

`@run-at document-start` matters: the runtime has to run before Yapin’s scripts to [see its modules](patching.md). `@grant none` runs it in the page itself, which the runtime needs.

## Updates

Host the file somewhere and set `web.updateURL` and `web.downloadURL` in the config. Userscript managers check those for newer `@version`s.

## Differences from desktop

| | Desktop | Web |
| --- | --- | --- |
| Storage | Files in the data folder | `localStorage` (about 5 MB for everything) |
| User plugins and themes | Files in a folder (edit and reload), or by link | By link only |
| API requests | From the main process: no CORS, allowlist enforced outside the page | From the page with `fetch`: your API needs CORS, allowlist enforced in the page |
| Secrets | Encrypted by the OS | Plain `localStorage` (`client.secrets.secure` is false) |
| Safe mode | Restart button, crash detection, `--yc-safe-mode` | Add `?yc-safe-mode` to the address |
| `client.host.desktop` | Yapin’s desktop bridge | null |
| About: environment | Desktop app, Electron, Chromium, Node, OS | Browser |

Plugins can check `client.host.platform` (`'desktop'` or `'web'`), or declare `platforms: ['desktop']` to only run in one.

## Turning it off

`web: { userscript: false }` skips the userscript.
