# Pages

Your client app's pages appear in Yapin’s **user settings** menu, under a label with your client app's name:

```js
client.pages.add({
  id: 'changelog',
  title: 'Changelog',
  render(root, ctx) {
    root.append(
      ctx.ui.heading('Changelog'),
      ctx.ui.section({ title: '1.4.0', children: [ctx.h('ul', null, ctx.h('li', null, 'Theme variables'))] }),
    );
  },
});
```

That's all a page needs: an id, a title, and a `render` function that fills `root`.

## The definition

| Field | | |
| --- | --- | --- |
| `id` | required | Lowercase letters, digits and dashes. `about`, `plugins`, `themes`, `settings` and `security` are taken by the built-in pages unless you remove them. |
| `title` | required | The nav entry. |
| `render(root, ctx)` | required | Draws the page. Return a function to run when it closes. |
| `section` | `'main'` | Which nav label it sits under ([below](#sections)). |
| `order` | `0` | Lower comes first; equal orders sort by title. The built-in pages use 0 (About), 5 (Settings), 10 (Plugins), 20 (Themes) and 30 (Security). |
| `icon` | | SVG markup (cleaned of scripts and links), an https or `data:` image URL, or an element. |
| `badge` | | A short tag after the title, like `NEW`. |
| `visible` | `true` | Or a function of the client, checked whenever the menu is drawn. |

`render` runs every time the page opens. `ctx` holds:

| | |
| --- | --- |
| `ctx.client`, `ctx.ui`, `ctx.h` | The client, the [UI kit](ui.md), the element builder. |
| `ctx.page` | This page's handle (`update`, `remove`, `open`). |
| `ctx.onDispose(fn)` | Run `fn` when the page closes (the person picks another page, or closes settings). |
| `ctx.close()` | Go back to the Yapin’ page that was open before. |

If `render` throws, the page shows the error instead of crashing settings.

## Changing and removing pages

```js
const page = client.pages.add({ id: 'beta', title: 'Beta', render });
page.update({ title: 'Beta features', badge: 'NEW' });   // the menu updates straight away
page.remove();

client.pages.update('about', { title: 'Info', order: 99 });
client.pages.remove('themes');
client.pages.list();
client.pages.open('beta');   // switches to it if settings is open; otherwise opens settings
```

Plugins add pages with `ctx.pages.add(…)` (removed when the plugin stops), or with a `page` field in the definition.

## Sections

The `main` section is labelled with your client app's name (or `pages.section` from the config). Add more:

```js
client.pages.section('tools', { label: 'Nebula tools', order: 1 });
client.pages.add({ id: 'logs', title: 'Logs', section: 'tools', render });
```

Rename one with `section(id, { label })`. Remove one with `removeSection(id)`; its pages move to `main`. Sections with no visible pages aren't drawn.

Where your sections go in Yapin’s menu is set by `pages.position` in the config: `end` (default), `start`, `before:App settings`, `after:User settings`, and so on, matched against Yapin’s own nav labels.

## How pages are drawn

Yapin’s settings menu is a React component. Changing its DOM directly would fight React, so the framework doesn't. Instead:

- your nav entries go in a `display: contents` wrapper inside the nav, so they lay out like Yapin’s own and pick up its button styles;
- while one of your pages is open, Yapin’s `section.settings-main` is hidden and the framework's own `section.settings-main` is shown next to it. Your page gets Yapin’s padding, heading sizes and scrolling for free;
- clicking one of Yapin’s nav entries closes your page and gives Yapin’ its section back. The active highlight goes back to where it was, even when React doesn't re-render.

Only user settings get your pages. Server settings and moderation menus are left alone (the framework recognises user settings by its first nav label, "User settings"; see [When Yapin’ changes](host-adapter.md)).

The client emits `settings:open` and `settings:close` as the menu opens and closes, and `page:open` and `page:close` with a page id.
