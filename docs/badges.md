# Badges

Badges are small icons or labels next to people's names. The framework ships none. You (or plugins) add **providers**, and the framework draws whatever they return into **slots** on the page.

## Providers

### A JSON file

The simplest provider is a file your server hosts. In the config:

```js
badges: {
  sources: [{ id: 'supporters', url: 'https://api.nebula.example/badges.json', refresh: '30m' }],
},
```

or from code:

```js
client.badges.addProvider({ id: 'supporters', url: 'https://api.nebula.example/badges.json', refresh: '30m' });
```

The file:

```json
{
  "badges": {
    "dev": { "label": "Developer", "icon": "https://cdn.nebula.example/badges/dev.png", "href": "https://nebula.example/team" },
    "supporter": { "label": "Supporter", "description": "Supports Nebula", "icon": "https://cdn.nebula.example/badges/heart.svg" }
  },
  "users": {
    "6b1f3c2e-…": ["dev", "supporter"],
    "9a0d…": ["supporter", { "id": "first", "label": "First user", "color": "#ffd166" }]
  }
}
```

`users` maps a Yapin’ user id to badge ids from `badges`, or to whole badges. A plain `{ "userId": [badge, …] }` map works too.

The file is fetched with the [API client](api.md), so its origin must be allowed. Sources in the config are added to the allowlist for you; for providers added in code, add the origin to `api.allowedOrigins`. It's reloaded every `refresh` (at least a minute).

### Your own loader

```js
client.badges.addProvider({
  id: 'supporters',
  refresh: '1h',
  load: () => client.api.service('backend').get('/badges'),   // same shape as the JSON file
});
```

### Per person

```js
client.badges.addProvider({
  id: 'staff',
  priority: 10,
  async get(userId) {
    const staff = await client.api.service('backend').get(`/staff/${userId}`, { cache: '10m' });
    return staff ? [{ id: 'staff', label: 'Staff', icon: '<svg viewBox="0 0 16 16">…</svg>' }] : [];
  },
});
```

`get` can be combined with `url` or `load`. Results are cached per person for `badges.cache.ttl` (15 minutes), and simultaneous requests for one person share one call.

### From code, for one person

```js
const remove = client.badges.add(userId, { id: 'tester', label: 'Tester' });
remove();
```

Plugins use `ctx.badges.addProvider(…)` and `ctx.badges.add(…)`, removed when the plugin stops.

## A badge

| Field | |
| --- | --- |
| `id` | Required. Duplicates from the same provider are shown once. |
| `label` | Shown as the tooltip, or as text when there's no icon. |
| `description` | Added to the tooltip. |
| `icon` | An https or `data:image/…` URL, or SVG markup. |
| `href` | Opens in the browser when clicked (https only). |
| `color`, `background` | Hex colours, for text badges. |
| `priority` | Higher comes first. Provider `priority` orders whole providers. |

Every badge is sanitised before it's drawn. Icons that aren't https or `data:` images are dropped. SVG markup is reduced to drawing elements (no scripts, event handlers, `foreignObject` or external links). Links must be https. Labels are text, never HTML. So a badge file can't inject anything into the page, even if your server is compromised. At most `badges.max` (6) badges are shown per person.

## Slots

Where badges are drawn. The defaults:

| Slot | Selector | Position | Size |
| --- | --- | --- | --- |
| `profile` | `.pc-sub-row` (profile cards and popouts) | `append` | `md` (18 px) |
| `message` | `.msg-head .msg-author` (names above messages) | `after` | `sm` (14 px) |

Change or add slots in the config:

```js
badges: {
  slots: {
    message: false,                                   // not next to message names
    profile: { size: 'lg' },
    memberList: { selector: '.member-row .name', position: 'after', size: 'sm' },
  },
},
```

`position` is `append`, `prepend`, `before` or `after`, relative to the matched element. `size` is `sm`, `md`, `lg` or a number of pixels.

### Finding whose name it is

Yapin’ doesn't put user ids in its markup. The framework finds them by walking up from the matched element through the React components that drew it, looking for a prop like `userId`, `user.id`, `profile.id`, `author.id` or `message.author_id` (the list is `host.userIdProps`). A slot can use different props:

```js
slots: { custom: { selector: '.thing', userIdProps: ['ownerId'] } }
```

Or, from code, a function:

```js
client.badges.slots();   // the slots in use
```

For a slot that needs a function, add it in your entry file by setting `client.config.badges.slots` before start isn't possible (the config is frozen), so draw it yourself instead:

```js
client.dom.observe('.thing', (element) => {
  const userId = element.dataset.owner;
  client.badges.for(userId).then((badges) => element.append(client.badges.render(badges, { size: 'sm' })));
});
```

## Reading badges

```js
await client.badges.for(userId);     // [{ id, label, icon, href, provider, … }]
client.badges.peek(userId);           // cached, or null
await client.badges.refresh();        // reload sources and redraw
client.badges.providers();            // [{ id, name, url, loaded }]
client.events.on('badges:update', (userId) => {});
```
