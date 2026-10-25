'use strict';

/**
 * Runs in every Yapin’ page before the page's own scripts (sandboxed, with context isolation, like
 * Yapin’s own preload). It asks the main process for the client app's runtime, injects it into the page,
 * and offers the runtime a native bridge.
 *
 * The bridge is behind a one-time `claim()`: the runtime, injected before any page script, claims it
 * first, and anything that asks later gets null. So scripts on the page (or anything injected into it)
 * can't use the bridge to write files or read secrets.
 */

const { contextBridge, ipcRenderer, webFrame } = require('electron');

const PREFIX = 'yapin-client:';

(function start() {
  if (process.isMainFrame === false) return;
  let boot = null;
  try {
    boot = ipcRenderer.sendSync(`${PREFIX}boot`);
  } catch {
    return;
  }
  if (!boot || typeof boot.runtime !== 'string' || !boot.args) return;

  const invoke = (name, ...args) => ipcRenderer.invoke(PREFIX + name, ...args);
  const fileListeners = new Set();
  ipcRenderer.on(`${PREFIX}file-changed`, (_event, kind, file, text) => {
    for (const listener of fileListeners) {
      try {
        listener(kind, file, text);
      } catch (error) {
        console.error('[yapin-client]', error);
      }
    }
  });

  const bridge = {
    storageWrite: (namespace, json, sync) => (sync ? ipcRenderer.sendSync(`${PREFIX}storage-write-sync`, namespace, json) : invoke('storage-write', namespace, json)),
    list: (kind) => invoke('list', kind),
    read: (kind, file) => invoke('read', kind, file),
    write: (kind, file, text) => invoke('write', kind, file, text),
    remove: (kind, file) => invoke('remove', kind, file),
    openFolder: (kind) => invoke('open-folder', kind),
    openExternal: (url) => invoke('open-external', url),
    request: (req) => invoke('request', req),
    secretGet: (name) => invoke('secret-get', name),
    secretSet: (name, value) => invoke('secret-set', name, value),
    secretDelete: (name) => invoke('secret-delete', name),
    relaunch: (options) => invoke('relaunch', options),
    onFileChange: (listener) => {
      fileListeners.add(listener);
      return () => fileListeners.delete(listener);
    },
  };

  let claimed = false;
  contextBridge.exposeInMainWorld(boot.args.nativeKey, {
    claim() {
      if (claimed) return null;
      claimed = true;
      return bridge;
    },
  });

  const code = `(${boot.runtime})().default(${JSON.stringify(boot.args)});\n//# sourceURL=yapin-client://${encodeURIComponent(boot.args.manifest.id)}/runtime.js`;
  webFrame.executeJavaScript(code).catch((error) => console.error('[yapin-client] the client app failed to start', error));
})();
