# Welcome and what's new

Two rounded, animated screens the framework can show on top of the app:

- **Welcome**, the first time the client app runs with nothing saved yet — a rounded-corner hero icon, a title and subtitle, and a short list of steps with their own icons.
- **What's new**, once after an update, when `whatsNew.entries` has something for the new version.

Both fade and scale in, with the hero icon settling into place and each row sliding in in sequence; everything respects `prefers-reduced-motion`. Both are entirely optional and entirely yours to edit.

## Turning them off

```js
welcome: false,     // no welcome screen, ever
whatsNew: false,    // no what's new screen, ever
```

Or just for one: `welcome: { enabled: false }`. `whatsNew` also stays quiet on its own whenever `entries` is empty — ship a release with nothing to say and nothing shows.

## Editing them

```js
welcome: {
  icon: 'sparkles',                         // a built-in icon, SVG, or an image URL — see UI kit → Icons
  title: 'Welcome to {name}',                // {name} and {version} are replaced
  subtitle: "Here's what you get out of the box.",
  steps: [
    { icon: 'puzzle', title: 'Plugins', description: 'Turn features on and off from Settings.' },
    { icon: 'palette', title: 'Themes', description: 'Apply a theme, or write your own CSS.' },
  ],
  actionLabel: 'Get started',
  dismissible: true,                        // false removes Escape, the backdrop click, and the Skip button
  dismissLabel: 'Skip',
},
whatsNew: {
  icon: 'rocket',
  title: "What's new in {name} {version}",
  entries: [
    { icon: 'sparkles', title: 'A redesigned Settings page', description: 'Find things faster.' },
    { icon: 'puzzle', title: 'Three new plugins', description: 'Enable them from the Plugins page.' },
  ],
  actionLabel: 'Got it',
},
```

A client app that only wants the hero and a message can leave `steps` / `entries` out (welcome still shows; what's new needs at least one entry to show at all).

## Replaying them from code

```js
client.welcome.show();     // right now, regardless of whether it's been seen
client.whatsNew.show();

client.welcome.reset();    // clears the "seen" flag, so it shows again next start
client.welcome.markSeen(); // marks it seen without showing it
```

A **Show welcome screen** / **Show what's new** button is added to the [About page](about-page.md) automatically whenever the screen is enabled (remove with `about: { actions: { welcome: false, whatsNew: false } }`).

`client.welcome` and `client.whatsNew` are `null` when turned off with `welcome: false` / `whatsNew: false`.

## How "seen" is tracked

Each screen stores one value — the version it was last seen at — in the client app's own storage, under `onboarding`. Welcome only needs to know whether it's ever run; what's new compares the stored version against `client.version`, so it shows again after every update that has entries (and only once per version).
