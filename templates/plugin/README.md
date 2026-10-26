# __NAME__

A plugin for Yapin’ client apps built with [yapin.js-client](https://github.com/yapin-js/yapin.js-client).

```sh
npm install
npm run dev      # build into __CLIENT__'s plugins folder, rebuild when you save
npm run build    # dist/__ID__.plugin.js — the single file people install
npm run check    # check the header and the code before you share it
```

- `yapin-plugin.json`: id, name, version, author, compatibility. The build turns this into the
  metadata header of the built file, so there's one place to edit.
- `src/index.js`: your plugin. Import other files freely; the build bundles them into one.

To share it, give people `dist/__ID__.plugin.js`. They install it from the Plugins page
(**Install from link**) or by dropping it in their client app's plugins folder.

Set `updateUrl` in the manifest to the https address you host that file at, and clients can offer
updates when you publish a new `version`.
