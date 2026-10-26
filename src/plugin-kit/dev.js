import { existsSync, mkdirSync, rmSync, watch, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildPlugin } from './build.js';
import { checkFile } from './check.js';
import { dataDir } from '../installer/paths.js';

/**
 * The edit-and-see-it loop for a standalone plugin project: build, write the single file straight into
 * a client app's plugins folder, and rebuild on save. The desktop shim already watches that folder and
 * reloads what changed (src/desktop/shim.cjs), so there is nothing to restart.
 */

/** The plugins folder of an installed client app: <appData>/yapin-client/<id>/plugins. */
export function pluginsFolder(clientId) {
  return join(dataDir(clientId), 'plugins');
}

/** Builds once and copies the result into the client app's plugins folder. */
export function installForDev(manifest, { root, clientId }) {
  const build = buildPlugin(manifest, { root });
  const folder = pluginsFolder(clientId);
  mkdirSync(folder, { recursive: true });
  const installed = join(folder, `${manifest.id}.plugin.js`);
  writeFileSync(installed, build.text);
  return { ...build, installed, folder };
}

/** Removes the development copy again. */
export function uninstallForDev(id, clientId) {
  const installed = join(pluginsFolder(clientId), `${id}.plugin.js`);
  if (!existsSync(installed)) return false;
  rmSync(installed);
  return true;
}

/**
 * Watches a plugin project and reinstalls it on every change. `onBuild` gets each result, `onError`
 * each failure — a broken save must not end the watch, because the next save usually fixes it.
 * Returns a function that stops watching.
 */
export function watchPlugin(manifest, { root, clientId, onBuild, onError, debounce = 150 }) {
  const ignore = [manifest.outDir, join(root, 'node_modules'), join(root, '.git')];
  let timer = null;
  let building = false;

  const run = async () => {
    if (building) return;
    building = true;
    try {
      const result = installForDev(manifest, { root, clientId });
      const { problems, warnings } = checkFile(result.installed, result.text);
      onBuild?.({ ...result, problems, warnings });
    } catch (error) {
      onError?.(error);
    } finally {
      building = false;
    }
  };

  const watcher = watch(root, { recursive: true }, (_event, file) => {
    if (!file) return;
    if (ignore.some((dir) => join(root, file).startsWith(dir))) return;
    clearTimeout(timer);
    timer = setTimeout(run, debounce);
  });

  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}

/** Where a built file would land, for messages. */
export function describeTarget(manifest, clientId, cwd = process.cwd()) {
  const installed = join(pluginsFolder(clientId), `${manifest.id}.plugin.js`);
  return relative(cwd, installed).startsWith('..') ? installed : relative(cwd, installed);
}
