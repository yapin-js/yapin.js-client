/** The framework version. Kept in step with package.json (a test checks it). */
export const version = '0.1.5';

/**
 * The plugin API version. Plugins declare the one they were written for (`apiVersion`), and the
 * runtime refuses plugins that ask for a newer one. Bumped only on breaking changes to `ctx`.
 */
export const apiVersion = 1;

/** Name of the marker file the installer writes into the stub app.asar. */
export const markerFile = 'yapin-client.json';

/** The original app.asar is renamed to this while a client app is installed. */
export const originalAsarName = '_app.asar';

/** IPC channel prefix shared by the desktop shim and preload. */
export const ipcPrefix = 'yapin-client:';

/** Origins the Yapin’ web app is served from. The runtime only starts on these. */
export const defaultOrigins = ['https://www.yapper.website', 'https://yapper.website', 'https://www.yapin.gg', 'https://yapin.gg'];

/** Plugin and theme ids, client app ids and storage namespaces. */
export const idPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
