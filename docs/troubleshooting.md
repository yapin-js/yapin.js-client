# Troubleshooting

Start with:

```sh
npx yapin-client doctor
```

It checks your config, finds the desktop app, and reports its state and anything unusual.

## Where to look

| | |
| --- | --- |
| The page | The devtools console (Ctrl+Shift+I). Every message from your client app is prefixed with its id; plugin messages also have the plugin's id. |
| The main process | `<appData>/yapin-client/<id>/logs/main.log` ([where that is](architecture.md#where-things-live-on-disk)) |
| What's running | About → **Copy debug info**: versions, enabled plugins and themes, recent warnings and errors |

## Safe mode

Safe mode starts the client app with every plugin and theme (including your base styles) turned off, but its pages still work, so people can turn off whatever is causing trouble.

It starts when:

- someone clicks **Restart in safe mode** on the About page (desktop);
- the renderer crashed twice within a minute of loading (`desktop.crashLimit`). After a minute without a crash, the count resets and the next start is normal;
- the desktop app was started with `--yc-safe-mode`, or `YAPIN_CLIENT_SAFE_MODE=1` is set;
- on the web, the address has `?yc-safe-mode`.

To start Yapin’ without the client app at all: `YAPIN_CLIENT_DISABLE=1`, or start the desktop app with `--yc-disable`.

## Common problems

**My section doesn't appear in settings.**
Check the console for errors at startup. If there are none, Yapin’ may have changed its settings markup: see [When Yapin’ changes](host-adapter.md). Check that your pages aren't all hidden (`visible`), and that you didn't remove them in the config.

**Yapin’ starts without my client app.**
The desktop app probably updated itself. Run the installer and choose Repair (or `yapin-client repair`). If that's not it, look in `main.log`: a damaged `runtime.js` (hash mismatch) or a missing payload is logged there.

**"Yapper is running" when installing.**
Close it completely: on Windows it may still be in the system tray. Or let the installer close it.

**"No permission to change …"**
On Linux, installs under `/opt` need `sudo ./install.sh`. On Windows, something else may be holding the files: close Yapin’ and any tool that has its folder open.

**"app.asar is "…", not yapper-desktop; another mod may be installed"**
Another mod has replaced the app. Uninstall it first, or reinstall the desktop app.

**A plugin shows "Stopped after errors".**
It failed 3 times within a minute. The errors are in the console, tagged with its id. Fix it and turn it back on (or restart).

**A plugin shows "Not compatible".**
Its `apiVersion` is newer than the framework's, it's limited to the other platform, it needs a newer version of your client app, or it's on your `plugins.blocked` list. The reason is shown under it.

**A theme doesn't change some colours.**
Yapin’ sets some variables with more specific selectors (light mode, tinted servers). Use `:root:root:root:root` for variables ([Themes](themes.md#winning-against-yapins-css)).

**Badges don't show.**
Check the provider loaded (`client.badges.providers()` shows `loaded`), that its origin is allowed (the console says if it isn't), and that the slot's selector matches something. If it does but there are still no badges, the user id prop may have changed: see [When Yapin’ changes](host-adapter.md).

**API requests fail with "isn't an allowed API origin".**
Add the origin to `api.services` or `api.allowedOrigins` and rebuild. The list is fixed at build time on purpose ([API access](api.md#the-allowlist)).

**API requests fail on the web but work on desktop.**
Your API needs CORS headers for Yapin’s origins ([The web version](web.md)).

**The build says something "is a function".**
Options that reach the running client app must be plain data. Move code into your entry file ([Configuration](configuration.md)).

**"Circular import" when building.**
Two of your files import each other. Move what they share into a third file.
