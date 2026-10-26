# Security

A client app runs with the same access as Yapin’ itself: it can see everything the signed-in person sees. That makes it worth attacking, and makes mistakes expensive. This page covers what the framework does, and what it can't do.

## The person's account

- The framework never reads, stores or sends Yapin’s session or token, and nothing in it talks to Yapin’s API.
- `client.api` never includes Yapin’s cookies or session, on desktop or web.
- Automating someone's account ("self-botting") breaks Yapin’s terms. Don't build features that send messages, join servers or act on someone's behalf without them doing it. For automation, use a bot account and [yapin.js](https://github.com/yapin-js/yapin.js).

## The native bridge (desktop)

The preload gives the page access to files, secrets and network requests. That access is only as safe as who can reach it.

- The bridge is behind a one-time `claim()`. The runtime is injected before Yapin’s scripts and claims it first; anything later gets nothing. If an attacker got script into Yapin’s page (an XSS bug in Yapin’, say), they still couldn't use the bridge to write a plugin file and stay on the computer.
- The main process checks every request: it must come from the main frame of a page on your `origins`. Iframes, popups and other sites are refused.
- File names are checked against a strict pattern and resolved inside their folder, so `../` can't escape. Only `.js` and `.css` files in the plugins and themes folders can be written.
- Storage writes are size-limited and must be valid JSON. Files are written atomically.
- `runtime.js` is checked against the hash in the manifest before it's loaded.

Keep `runtime.exposeGlobal` off in production. It puts the client object on `window`, where any script on the page could install plugins with it.

## Network

- `client.api` reaches only allowed origins. On desktop, the allowlist is read by the main process from the manifest, so code in the page can't add to it. Redirects are re-checked at every hop.
- Responses are size-limited, and redirects are capped.
- Plugin and theme downloads (install from link) must be https, are size-limited, and can be limited to certain hosts (`user.install.allowedHosts`).

## What people install themselves

User plugins are code from strangers, running with full access to the page. The framework can't sandbox them: there is no JavaScript sandbox that a determined plugin can't escape when it shares a page with what it's acting on. What's left is making sure nobody installs one by accident, or without knowing whose code they are about to run.

**Before anything runs**, the install dialog shows the plugin's name, version, authors (linked, where the header gives a link), description, the link it came from and its size, and says plainly what a plugin can do. The **Install** button stays disabled until the person ticks:

> I trust *Ada* and understand this plugin can see and change anything I do in Yapin'.

That tick is the point: the person has to say who they are trusting, not just dismiss a dialog. Under it, they can choose to remember that they trust those authors, which pre-ticks the box next time (and nothing else — it never skips the dialog). Authors your client app vouches for in `security.trustedAuthors` start out ticked and are tagged as trusted by you.

Themes get the same dialog with a lighter warning and no tick, because a theme is CSS: it can't run code, but it can load images from other sites.

**The Security page** (built in, `pages.security`) is where the person sees and undoes all of it: whether installing from links is allowed at all, whether they're asked every time, the authors they've said they trust (with *Forget*), and everything they've installed — where each one came from and when.

**In your config** you can turn user plugins off (`plugins.user.enabled: false`), allow files but not links (`install.url: false`), limit where links may point (`install.allowedHosts`), block known-bad ids (`plugins.blocked`), reword the warning (`security.warning`), and vouch for authors (`security.trustedAuthors`). See [`security`](configuration.md#security).

The person's own settings can only make your rules stricter, never looser, and a plugin's failures never take the client app down.

If your client app has a plugin directory, make `allowedHosts` point at it, and review what you list there.

## Rendering untrusted content

Badges from a server, theme metadata, plugin descriptions and installer text all end up on screen. The framework never puts them into the page as HTML:

- `h()` sets text as text and refuses `innerHTML`;
- icons must be https or `data:` images, and SVG markup is reduced to drawing elements (no scripts, handlers, `foreignObject` or external references);
- links must be https (or mailto), and open in the browser;
- theme variable values that could break out of a CSS declaration are dropped.

Do the same in your own code. If you must render HTML from somewhere else, sanitise it.

## The installer

- The installer page listens on `127.0.0.1` only, on a random port, with a random token (in the URL fragment, so it's never sent anywhere), checking Host and Origin headers, under a strict Content-Security-Policy. Other websites open in the browser can't trigger installs.
- It refuses to install over another mod or another client app, or into an app with asar integrity checking.
- Every change it makes can be undone, and is undone if a later step fails.

## Content-Security-Policy

Yapin’ doesn't currently send a Content-Security-Policy. If it starts to:

- the runtime keeps working (it's injected by the preload, and its styles use `adoptedStyleSheets`);
- user plugins (imported from `blob:` URLs) would stop loading. On desktop, `desktop.csp: 'relax'` adds `blob:` to `script-src` for Yapin’s pages and changes nothing else. On the web there's no fix.

`yapin-client doctor` tells you when a policy appears.

## Reporting problems

If you find a security problem in the framework, report it privately to the maintainers rather than in a public issue.
