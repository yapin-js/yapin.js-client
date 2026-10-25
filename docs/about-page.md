# The About page

Every client app gets an About page in settings, filled in by the build:

| Section | Field ids | |
| --- | --- | --- |
| `app` | `app.name`, `app.version`, `app.description`, `app.authors`, `app.safeMode` | From your config and package.json. `app.safeMode` only shows in safe mode. |
| `build` (Build) | `build.date`, `build.mode`, `build.framework`, `build.pluginApi` | When and how it was built. |
| `git` (Source) | `git.branch`, `git.commit`, `git.tag`, `git.date`, `git.dirty`, `git.remote` | Read from git at build time. The commit links to your host (GitHub, GitLab, Bitbucket, Codeberg, Gitea). Credentials in the remote URL are never included. Missing if the project isn't a git repository, or with `git: false`. |
| `environment` (Environment) | `environment.platform`, `environment.desktop`, `environment.electron`, `environment.chrome`, `environment.node`, `environment.os` | Where it's running. |
| `links` (Links) | `links.<key>` | One per entry in your config's `links`. |

Under the rows are buttons: **Copy debug info** (`copy`), and on desktop **Open data folder** (`folder`) and **Restart in safe mode** (`safeMode`).

**Copy debug info** copies every row as text, plus enabled plugins and themes (with versions and sources) and the last 20 warnings and errors. It's what you want in bug reports.

## Changing it from the config

```js
about: {
  title: 'About Nebula',
  intro: 'Thanks for using Nebula!',
  sections: {
    environment: false,                              // hide a whole section
    support: { title: 'Support', order: 35 },        // add one (built-in orders: 0, 10, 20, 30, 40)
  },
  fields: {
    'git.remote': false,                             // hide a row
    'build.mode': 'Release',                         // a string replaces the value
    'app.version': { label: 'Release' },             // change only the label
    'support.email': { label: 'Email', value: 'help@nebula.example', copy: true },
    'support.chat': { label: 'Chat', value: 'nebula.example/chat', href: 'https://nebula.example/chat' },
  },
  actions: { safeMode: false },                      // remove a button
},
```

`about: false` removes the page.

## Changing it from code

Your entry file and plugins can change it at any time. If the page is open, it redraws.

```js
client.about.set('app.version', { value: `${client.version} (beta)` });
client.about.set('stats.plugins', { label: 'Plugins running', value: () => String(client.plugins.list().filter((p) => p.status === 'running').length) });
client.about.remove('git.dirty');
client.about.section('stats', { title: 'Stats', order: 25 });
client.about.removeSection('environment');
client.about.action('report', { label: 'Report a bug', run: (client) => client.openExternal('https://github.com/ada/nebula/issues/new') });
client.about.removeAction('folder');
client.about.debugInfo();   // the text Copy debug info copies
```

A field is `{ label, value, href, copy, code, order, hidden }`:

| | |
| --- | --- |
| `value` | Text, or a function returning text (called whenever the page draws). |
| `href` | Makes the value a link. Only https and mailto links are used. |
| `copy` | Adds a Copy button: `true` copies the value, a string copies that string. |
| `code` | Monospace. |
| `order` | Position within its section. |
| `hidden` | Kept but not shown. |

`set` only changes the options you pass. Setting a field in a section that doesn't exist creates the section.

To take the page out entirely from code: `client.pages.remove('about')`. To move it: `client.pages.update('about', { order: 50, title: 'Info' })`.
