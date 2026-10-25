import { Client } from './client.js';
import { installTurbopackHook } from './modules.js';
import { defaultOrigins } from '../shared/constants.js';

let current = null;

/** The running client, once booted (null before, and outside the Yapin’ page). */
export function getClient() {
  return current;
}

/**
 * The first thing that runs in the page. `args` comes from the desktop preload or the userscript;
 * `bundle` is what the build packed in (the client app's entry, bundled plugins and themes).
 *
 * The Turbopack hook goes in before anything else, synchronously, so it sees the app's first chunk.
 * Everything after that is wrapped so a failure here can never break Yapin’ itself.
 */
export function boot(args = {}, bundle = {}) {
  let hook = null;
  try {
    hook = installTurbopackHook(globalThis);
  } catch (error) {
    console.error('[yapin.js-client] module hook failed', error);
  }
  try {
    const manifest = args.manifest ?? {};
    const origins = manifest.config?.origins ?? defaultOrigins;
    const origin = globalThis.location?.origin;
    if (origin && !origins.includes(origin)) return null;
    if (current) return current;
    let native = null;
    if (args.nativeKey) {
      const bridge = globalThis[args.nativeKey];
      native = typeof bridge?.claim === 'function' ? bridge.claim() : null;
    }
    const safeMode = Boolean(args.safeMode) || /[?&]yc-safe-mode\b/.test(globalThis.location?.search ?? '');
    const client = new Client({ manifest, native, snapshot: args.snapshot, safeMode, environment: args.environment, hook });
    current = client;
    client.start({ ...bundle, snapshot: args.snapshot }).catch((error) => client.reportError(error, { where: 'start' }));
    return client;
  } catch (error) {
    console.error('[yapin.js-client] failed to start', error);
    return null;
  }
}
