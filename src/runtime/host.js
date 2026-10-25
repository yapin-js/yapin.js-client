import { deepMerge } from './util.js';

/**
 * Everything the framework knows about Yapin’s own page lives here: which selectors find the settings
 * menu, which classes make a control look native, how to tell user settings from server settings.
 * When Yapin’ changes its markup, this is the one place to update, and every client app can override
 * any of it from its config (`host: { selectors: { … } }`) without waiting for a framework release.
 *
 * Checked against the Yapin’ web app of October 2026.
 */
export const defaultHost = Object.freeze({
  selectors: {
    settingsRoot: '.settings',
    settingsNav: 'nav.settings-nav',
    settingsNavLabel: '.settings-nav-label',
    settingsNavItem: 'nav.settings-nav > button, nav.settings-nav .settings-nav-group > button',
    settingsMain: 'section.settings-main',
    settingsButton: 'button[aria-label="Settings"]',
    profileBadges: '.pc-sub-row',
    messageAuthor: '.msg-head .msg-author',
  },
  classes: {
    navLabel: 'settings-nav-label',
    navActive: 'active',
    settingsMain: 'settings-main',
    button: 'btn',
    buttonSmall: 'small',
    buttonGhost: 'ghost',
    buttonDanger: 'danger',
    input: 'input',
    field: 'field',
    toggleRow: 'toggle-row',
    toggleLabel: 'toggle-label',
    switch: 'switch',
    hint: 'hint',
    newBadge: 'new-badge',
  },
  /** First nav label in the user settings menu. Server and moderation settings use other labels. */
  userSettingsLabel: 'User settings',
  /** Prop names that carry a user id in Yapin’s React tree, tried in order. */
  userIdProps: ['userId', 'user.id', 'profile.id', 'author.id', 'authorId', 'message.author_id', 'member.user_id'],
});

export class Host {
  #desktop;

  constructor(overrides = {}, { win = globalThis.window } = {}) {
    this.config = deepMerge(structuredClone(defaultHost), overrides);
    this.selectors = this.config.selectors;
    this.classes = this.config.classes;
    this.window = win;
    this.#desktop = win?.yapperDesktop ?? null;
  }

  /** 'desktop' inside the Yapin’ desktop app, otherwise 'web'. */
  get platform() {
    return this.#desktop ? 'desktop' : 'web';
  }

  get isDesktop() {
    return Boolean(this.#desktop);
  }

  /** The desktop app's own bridge (window.yapperDesktop), or null in a browser. */
  get desktop() {
    return this.#desktop;
  }

  get desktopVersion() {
    return this.#desktop?.version || null;
  }

  /** 'dark' or 'light', from the page's data-theme attribute. */
  get colorScheme() {
    return this.window?.document?.documentElement?.dataset?.theme === 'light' ? 'light' : 'dark';
  }

  /** Calls fn('dark' | 'light') whenever Yapin’ switches theme. Returns a stop function. */
  onColorSchemeChange(fn) {
    const root = this.window?.document?.documentElement;
    if (!root || typeof MutationObserver !== 'function') return () => {};
    let last = this.colorScheme;
    const observer = new MutationObserver(() => {
      const now = this.colorScheme;
      if (now !== last) fn((last = now));
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }

  /** True when `nav` is the user settings menu (not server settings or moderation). */
  isUserSettings(nav) {
    if (typeof this.config.isUserSettings === 'function') return Boolean(this.config.isUserSettings(nav));
    const label = nav.querySelector(this.selectors.settingsNavLabel);
    return label?.textContent?.trim().toLowerCase() === String(this.config.userSettingsLabel).toLowerCase();
  }

  className(...keys) {
    return keys.map((key) => this.classes[key] ?? key).filter(Boolean).join(' ');
  }
}
