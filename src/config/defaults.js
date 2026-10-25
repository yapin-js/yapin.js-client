import { defaultOrigins } from '../shared/constants.js';

/**
 * Every config option and its default. The config file is merged over this. Options under `plugins`,
 * `themes`, `pages`, `about`, `badges`, `api`, `host`, `settings`, `runtime` and `desktop` reach the
 * running client app, so they must be plain data (no functions); code goes in the entry file.
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

  pages: {
    section: null,
    position: 'end',
    plugins: { title: 'Plugins', order: 10 },
    themes: { title: 'Themes', order: 20 },
    settings: { title: 'Settings', order: 5 },
  },

  about: {
    title: 'About',
    order: 0,
    intro: null,
    sections: {},
    fields: {},
    actions: {},
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
