export default {
  id: 'sample-client',
  name: 'Sample Client',
  version: '1.2.3',
  description: 'Test fixture.',
  authors: ['Tester'],
  links: { website: 'https://example.com' },
  entry: './src/index.js',
  git: false,
  settings: { compact: { type: 'switch', default: false, label: 'Compact' } },
  api: { services: { backend: { baseURL: 'https://api.example.com/v1' } } },
  badges: { sources: [{ id: 'remote', url: 'https://badges.example.com/badges.json' }] },
  installer: { preset: 'showcase', marketing: './installer/marketing.json' },
};
