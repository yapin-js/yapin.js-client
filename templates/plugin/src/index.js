import { definePlugin } from 'yapin.js-client/runtime';

/**
 * __NAME__.
 *
 * Everything you need is on `ctx`: `ctx.observe` for elements that come and go, `ctx.on` for client
 * events, `ctx.css` for styles, `ctx.settings`, `ctx.storage`, `ctx.api`, `ctx.ui`, `ctx.h` for
 * markup, and `ctx.patch` for patching Yapin’ itself. Anything you register through `ctx` is undone
 * when the plugin stops, so most plugins never need a `stop()`.
 *
 * The id, name, version and author come from yapin-plugin.json — don't repeat them here.
 *
 * @see https://github.com/yapin-js/yapin.js-client/blob/main/docs/plugin-development.md
 */
export default definePlugin({
  settings: {
    greeting: { type: 'text', label: 'Greeting', default: 'Hello' },
  },

  start(ctx) {
    ctx.logger.info('started');
    ctx.toast(`${ctx.settings.get('greeting')} from __NAME__`);
  },
});
