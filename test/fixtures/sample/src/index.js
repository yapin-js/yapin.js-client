import { helper } from './helper.js';
export default function setup(client) {
  globalThis.__sampleSetup = helper(client.name);
  client.about.set('custom.thing', { label: 'Thing', value: 'yes' });
}
