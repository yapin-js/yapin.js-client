# When Yapin’ changes

Everything the framework knows about Yapin’s page is in one place: the host adapter (`src/runtime/host.js`). When Yapin’ changes its markup, that's what needs updating. You can override any of it from your config without waiting for a framework release.

## What's in it

```js
{
  selectors: {
    settingsRoot: '.settings',                     // the settings modal
    settingsNav: 'nav.settings-nav',               // its menu
    settingsNavLabel: '.settings-nav-label',       // "User settings", "App settings"
    settingsMain: 'section.settings-main',         // the page area
    settingsButton: 'button[aria-label="Settings"]', // opens user settings
    profileBadges: '.pc-sub-row',                  // the row under a name on profile cards
    messageAuthor: '.msg-head .msg-author',        // names above messages
  },
  classes: {
    navLabel: 'settings-nav-label', navActive: 'active', settingsMain: 'settings-main',
    button: 'btn', buttonSmall: 'small', buttonGhost: 'ghost', buttonDanger: 'danger',
    input: 'input', field: 'field', toggleRow: 'toggle-row', toggleLabel: 'toggle-label',
    switch: 'switch', hint: 'hint', newBadge: 'new-badge',
  },
  userSettingsLabel: 'User settings',              // how user settings is told apart from server settings
  userIdProps: ['userId', 'user.id', 'profile.id', 'author.id', 'authorId', 'message.author_id', 'member.user_id'],
}
```

These were checked against the Yapin’ web app in October 2026.

## Overriding

```js
// yapin-client.config.js
host: {
  selectors: { messageAuthor: '.message-header .username' },
  classes: { button: 'button' },
  userSettingsLabel: 'Your account',
},
```

Only what you list changes. From code, `client.host.config.isUserSettings = (nav) => …` replaces the label check entirely.

## What breaks, and how you'd notice

| If Yapin’ changes | You'd see | Fix |
| --- | --- | --- |
| The settings markup | Your section doesn't appear in settings | `selectors.settingsNav`, `settingsNavLabel`, `settingsMain`, `settingsRoot` |
| The first nav label's text | Your section doesn't appear (or appears in server settings) | `userSettingsLabel` |
| Control classes | Your pages' buttons and inputs look unstyled | `classes` |
| Profile card or message markup | No badges | `selectors.profileBadges`, `messageAuthor`, or [badge slots](badges.md#slots) |
| Prop names | No badges, even though the slot matches | `userIdProps` |
| Variable names | Themes stop applying | Update your themes; check `getComputedStyle(document.documentElement)` |
| Bundler internals | `client.modules.available` stays false | Framework update needed |
| Internal module names | Patches report "couldn't find" | Update the patches |
| The desktop app moves | The installer can't find it | `installer.target.locations` |
| Asar integrity checking turned on | The installer refuses | Nothing can be done from outside |

## Finding the new selector

1. Open the desktop app's devtools (Ctrl+Shift+I in a development build, or the web app in a browser).
2. Right-click the thing in question and choose **Inspect**.
3. Prefer stable-looking class names (`settings-nav`) over generated ones (`css-1x2y3z`), and short selectors over long ones.
4. Test in the console: `document.querySelectorAll('your selector')`.

For user id props, select an element in the Elements panel and run:

```js
yourClient.react.findProps($0, (props) => { console.log(props); return false; });
```

That logs the props of every React component above the element. Look for one that holds the user id.
