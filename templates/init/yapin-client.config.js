import { defineConfig } from 'yapin.js-client';

// Every option is described in node_modules/yapin.js-client/docs/configuration.md.
export default defineConfig({
  id: '__ID__',
  name: '__NAME__',
  description: '',
  authors: [],
  links: {
    // website: 'https://example.com',
    // source: 'https://github.com/you/__ID__',
  },

  // Your own code, run in the page with the client object: export default function setup(client) {}
  entry: './src/index.js',

  plugins: {
    dirs: ['./plugins'],
  },

  themes: {
    dirs: ['./themes'],
  },

  // Drop .svg files in ./icons to use them by name (icons/brand.svg -> icon: 'brand').
  // A name matching a built-in replaces it. See docs/ui.md.
  icons: {
    dirs: ['./icons'],
  },

  installer: {
    preset: 'default',
    marketing: './installer/marketing.json',
  },
});
