/**
 * What client app code and plugins import:
 *
 *   import { definePlugin, h } from 'yapin.js-client/runtime';
 *
 * This runs in the Yapin’ page, not in Node. The build bundles it into the client app.
 */
export { definePlugin, PluginContext, PluginManager } from './plugins.js';
export { getClient } from './boot.js';
export { Client } from './client.js';
export { h, svg, UI } from './ui.js';
export { Security } from './security.js';
export { Settings, SettingTypes, normalizeSchema } from './settings.js';
export { ClientError, ApiError, ErrorCodes } from './errors.js';
export { filters, ModuleFinder } from './modules.js';
export { Patcher } from './patcher.js';
export { parseMeta, parseVar } from './meta.js';
export { variablesCSS, VARIABLE_SELECTOR, StyleOrder } from './themes.js';
export { parseTable as parseBadgeTable } from './badges.js';
export { defaultHost } from './host.js';
export { version, apiVersion } from '../shared/constants.js';

/** Marks an object as a theme definition (for editor types). Returns it unchanged. */
export function defineTheme(definition) {
  return definition;
}

/** Marks a page definition (for editor types). Returns it unchanged. */
export function definePage(definition) {
  return definition;
}

/** Marks a badge provider definition (for editor types). Returns it unchanged. */
export function defineBadgeProvider(definition) {
  return definition;
}
