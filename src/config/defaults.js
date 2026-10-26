import { defaultOrigins } from '../shared/constants.js';

/**
 * Every config option and its default. The config file is merged over this. Options under `plugins`,
 * `themes`, `security`, `pages`, `about`, `badges`, `api`, `host`, `settings`, `runtime` and `desktop`
 * reach the running client app, so they must be plain data (no functions); code goes in the entry file.
 * docs/configuration.md describes each option.
 */
export const defaults = Object.freeze({
  id: null,
  name: null,
  version: null,
  description: '',
  authors: [],
  links: {},
  icon: null,
  entry: null,
  origins: defaultOrigins,
  outDir: 'dist',

  settings: {},

  runtime: {
    logLevel: null,
    logColor: '#7c5cff',
    exposeGlobal: null,
  },

  plugins: {
    dirs: ['plugins'],
    enabled: {},
    required: [],
    hidden: [],
    blocked: [],
    crash: { limit: 3, window: 60_000 },
    user: {
      enabled: true,
      install: { url: true, allowedHosts: [], maxBytes: 1_000_000 },
    },
  },

  themes: {
    dirs: ['themes'],
    enabled: {},
    multiple: true,
    css: null,
    variables: null,
    customCSS: { enabled: true, title: 'Custom CSS', description: null },
    user: {
      enabled: true,
      install: { url: true, allowedHosts: [], maxBytes: 2_000_000 },
    },
  },

  security: {
    // 'always' asks before installing anything the person chose; 'plugins' asks for plugins only
    // (they can still ask for themes too, on the Security page). Plugins are never installed silently.
    confirmInstall: 'always',
    // Make people tick "I trust the authors" before a plugin installs.
    trustGate: true,
    // Offer to remember authors they trusted, so the next plugin from the same author starts ticked.
    rememberAuthors: true,
    // Authors this client app vouches for, as names or { name, url }. Their plugins start out ticked.
    trustedAuthors: [],
    // Your own wording for the install warning: a string, or { plugins, themes }.
    warning: null,
  },

  icons: {
    // Every .svg in these folders is registered under its file name, so `icons/brand.svg` is `icon: 'brand'`.
    dirs: ['icons'],
    // Icons given inline as `{ name: '<svg…>' }`. A name that matches a built-in replaces it.
    set: {},
  },

  pages: {
    section: null,
    position: 'end',
    plugins: { title: 'Plugins', order: 10, icon: 'puzzle' },
    themes: { title: 'Themes', order: 20, icon: 'palette' },
    settings: { title: 'Settings', order: 5, icon: 'sliders' },
    security: { title: 'Security', order: 30, icon: 'shieldCheck' },
  },

  about: {
    title: 'About',
    order: 0,
    icon: 'info',
    logo: null,
    intro: null,
    sections: {},
    fields: {},
    actions: {},
  },

  welcome: {
    enabled: true,
    icon: 'sparkles',
    title: 'Welcome to {name}',
    subtitle: null,
    steps: [],
    actionLabel: 'Get started',
    dismissible: true,
    dismissLabel: 'Skip',
  },

  whatsNew: {
    enabled: true,
    icon: 'rocket',
    title: "What's new in {name} {version}",
    subtitle: null,
    entries: [],
    actionLabel: 'Got it',
    dismissible: true,
    dismissLabel: null,
  },

  badges: {
    enabled: true,
    sources: [],
    slots: {},
    max: 6,
    cache: { ttl: '15m' },
  },

  api: {
    services: {},
    allowedOrigins: [],
  },

  host: {},

  desktop: {
    csp: 'leave',
    devtools: true,
    crashLimit: 2,
  },

  web: {
    userscript: true,
    namespace: null,
    updateURL: null,
    downloadURL: null,
    matches: null,
  },

  git: true,

  installer: {
    preset: 'default',
    marketing: {},
    target: {},
    closeApp: 'ask',
    launchAfter: true,
    zip: true,
    gui: true,
    windows: {
      exe: true,
      fileName: null,
      icon: null,
      company: null,
      sign: null,
      nsis: true,
      sidebar: null,
      header: null,
    },
  },
});
