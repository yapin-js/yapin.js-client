/**
 * @id single
 * @name Single
 */
import { definePlugin } from 'yapin.js-client/runtime';
export default definePlugin({
  id: 'single',
  name: 'Single',
  enabledByDefault: true,
  settings: { count: { type: 'number', default: 2, min: 0 } },
  start(ctx) {
    globalThis.__singleStarted = ctx.settings.get('count');
  },
});
