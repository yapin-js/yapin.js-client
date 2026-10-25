import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createArchive, readFile } from './asar.js';
import { checkFuses, readFuses } from './fuses.js';
import { dataDir as defaultDataDir, defaultTarget, executablePath, expandPath, resourcesDir } from './paths.js';
import { markerFile, originalAsarName } from '../shared/constants.js';

/** Version of the stub app.asar. Bumped when its code changes, so `repair` rewrites old stubs. */
export const STUB_VERSION = 1;

export class InstallError extends Error {
  constructor(message, { code = 'INSTALL_FAILED', cause, hint } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'InstallError';
    this.code = code;
    this.hint = hint ?? null;
  }
}

const STUB_INDEX = `'use strict';
// Written by yapin.js-client. Starts the client app, then Yapin’ itself from ${originalAsarName}.
// Uninstall with the client app's installer, or by deleting this file and renaming ${originalAsarName} back to app.asar.
const fs = require('fs');
const path = require('path');
const marker = JSON.parse(fs.readFileSync(path.join(__dirname, '${markerFile}'), 'utf8'));
const original = path.join(process.resourcesPath, marker.originalAsar);
try {
  if (process.env.YAPIN_CLIENT_DISABLE !== '1' && !process.argv.includes('--yc-disable')) {
    const shim = path.join(marker.payloadDir, 'shim.cjs');
    if (fs.existsSync(shim)) require(shim)({ payloadDir: marker.payloadDir, marker });
  }
} catch (error) {
  console.error('[yapin-client] could not start; opening Yapin’ without it.', error);
}
const pkg = JSON.parse(fs.readFileSync(path.join(original, 'package.json'), 'utf8'));
const { app } = require('electron');
if (typeof app.setAppPath === 'function') app.setAppPath(original);
require(path.join(original, pkg.main || 'index.js'));
`;

function readPackage(asar) {
  try {
    const raw = readFile(asar, 'package.json');
    return raw ? JSON.parse(raw.toString('utf8')) : null;
  } catch {
    return null;
  }
}

function readMarker(asar) {
  try {
    const raw = readFile(asar, markerFile);
    return raw ? JSON.parse(raw.toString('utf8')) : null;
  } catch {
    return null;
  }
}

/**
 * What state an install is in:
 * - 'clean': the original app, nothing installed.
 * - 'installed': this framework's stub is in place (`marker.id` says which client app).
 * - 'needs-repair': the app updated itself over the stub, or files are half-moved.
 * - 'foreign': app.asar isn't Yapin’ and isn't ours (another mod?). Not touched without `force`.
 * - 'missing': there's no app.asar at all.
 */
export function inspect(resources, { target = defaultTarget } = {}) {
  const appAsar = join(resources, 'app.asar');
  const original = join(resources, originalAsarName);
  const hasApp = existsSync(appAsar);
  const hasOriginal = existsSync(original);
  if (!hasApp) {
    return hasOriginal ? { state: 'needs-repair', reason: `app.asar is missing but ${originalAsarName} is there`, resources } : { state: 'missing', reason: 'No app.asar here', resources };
  }
  const marker = readMarker(appAsar);
  const pkg = readPackage(appAsar);
  if (marker) {
    if (!hasOriginal) return { state: 'needs-repair', reason: `The client app is installed but ${originalAsarName} is missing`, marker, resources };
    const originalPkg = readPackage(original);
    return { state: 'installed', marker, version: originalPkg?.version ?? null, stubVersion: marker.stubVersion ?? 0, resources };
  }
  if (pkg?.name === target.packageName) {
    if (hasOriginal) return { state: 'needs-repair', reason: 'The desktop app updated itself; the client app needs to be put back', version: pkg.version, stale: true, resources };
    return { state: 'clean', version: pkg.version, resources };
  }
  return { state: 'foreign', reason: `app.asar is "${pkg?.name ?? 'unknown'}", not ${target.packageName}; another mod may be installed`, resources };
}

/** Every Yapin’ desktop install on this machine: [{ location, resources, executable, status, fuses }]. */
export function findInstalls({ target = defaultTarget, platform = process.platform, env = process.env, extra = [] } = {}) {
  const locations = [...extra, ...(target.locations?.[platform] ?? [])].map((p) => expandPath(p, env));
  const seen = new Set();
  const out = [];
  for (const location of locations) {
    const resources = resourcesDir(location);
    if (!resources || seen.has(resources.toLowerCase())) continue;
    seen.add(resources.toLowerCase());
    const status = inspect(resources, { target });
    if (status.state === 'missing') continue;
    const executable = executablePath(location, target, platform);
    let fuses = null;
    try {
      fuses = executable ? readFuses(executable) : null;
    } catch {
      fuses = null;
    }
    out.push({ location, resources, executable, status, fuses, fuseCheck: checkFuses(fuses) });
  }
  return out;
}

function withLock(resources, fn) {
  const lock = join(resources, 'yapin-client.lock');
  try {
    if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 10 * 60_000) rmSync(lock, { force: true });
    closeSync(openSync(lock, 'wx'));
  } catch (cause) {
    if (cause.code === 'EEXIST') throw new InstallError('Another install is running on this app right now', { code: 'LOCKED' });
    throw permissionError(cause, resources);
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

function permissionError(cause, resources) {
  if (cause instanceof InstallError) return cause;
  if (cause?.code === 'EACCES' || cause?.code === 'EPERM') {
    return new InstallError(`No permission to change ${resources}`, {
      code: 'PERMISSION',
      cause,
      hint: process.platform === 'win32' ? 'Close the desktop app (and anything else using it), then try again.' : 'Run the installer with sudo, or close the desktop app and try again.',
    });
  }
  if (cause?.code === 'EBUSY') return new InstallError('The desktop app is still running', { code: 'BUSY', cause, hint: 'Close it completely (check the system tray), then try again.' });
  return new InstallError(cause?.message ?? String(cause), { cause });
}

/** Copies the built payload into <dataDir>/app, replacing the old one only once the copy is complete. */
export function installPayload(payloadSource, dir) {
  const app = join(dir, 'app');
  const next = join(dir, 'app.next');
  const old = join(dir, 'app.old');
  mkdirSync(dir, { recursive: true });
  rmSync(next, { recursive: true, force: true });
  rmSync(old, { recursive: true, force: true });
  cpSync(payloadSource, next, { recursive: true });
  if (!existsSync(join(next, 'manifest.json'))) throw new InstallError(`${payloadSource} has no manifest.json; build the client app first`);
  if (existsSync(app)) renameSync(app, old);
  renameSync(next, app);
  rmSync(old, { recursive: true, force: true });
  for (const sub of ['plugins', 'themes', 'storage', 'logs']) mkdirSync(join(dir, sub), { recursive: true });
  return app;
}

function writeStub(resources, { manifest, payloadDir, originalPkg }) {
  const pkg = {
    name: originalPkg.name,
    productName: originalPkg.productName,
    version: originalPkg.version,
    description: originalPkg.description,
    author: originalPkg.author,
    homepage: originalPkg.homepage,
    desktopName: originalPkg.desktopName,
    main: 'index.js',
    private: true,
  };
  const marker = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    framework: manifest.framework,
    stubVersion: STUB_VERSION,
    payloadDir,
    originalAsar: originalAsarName,
    installedAt: new Date().toISOString(),
  };
  createArchive({ 'package.json': JSON.stringify(pkg, null, 2), 'index.js': STUB_INDEX, [markerFile]: JSON.stringify(marker, null, 2) }, join(resources, 'app.asar'));
  return marker;
}

/**
 * Installs (or updates) a client app into one desktop install.
 *
 * @param {object} options
 * @param {string} options.resources      The app's resources folder.
 * @param {string} options.payload        The built payload folder (dist/payload).
 * @param {object} [options.target]       Overrides for where/what the desktop app is.
 * @param {string} [options.dataDir]      Where the client app's files go (default: <appData>/yapin-client/<id>).
 * @param {boolean} [options.force]       Install over a foreign app.asar or another client app.
 * @param {(step: string) => void} [options.onStep]
 */
export function install({ resources, payload, target = defaultTarget, dataDir, force = false, onStep = () => {} }) {
  const manifest = JSON.parse(readFileSync(join(payload, 'manifest.json'), 'utf8'));
  const dir = dataDir ?? defaultDataDir(manifest.id);
  return withLock(resources, () => {
    const status = inspect(resources, { target });
    onStep(`Found the desktop app (${status.state})`);
    if (status.state === 'missing') throw new InstallError(`No desktop app in ${resources}`, { code: 'NOT_FOUND' });
    if (status.state === 'foreign' && !force) {
      throw new InstallError(status.reason, { code: 'FOREIGN', hint: 'Uninstall the other mod first. Installing anyway would replace it.' });
    }
    if (status.state === 'installed' && status.marker.id !== manifest.id && !force) {
      throw new InstallError(`${status.marker.name ?? status.marker.id} is already installed`, { code: 'OTHER_CLIENT', hint: `Only one client app can be installed at a time. Uninstall ${status.marker.name ?? status.marker.id} first.` });
    }

    onStep('Copying files');
    const payloadDir = installPayload(payload, dir);
    try {
      const appAsar = join(resources, 'app.asar');
      const original = join(resources, originalAsarName);
      const unpacked = join(resources, 'app.asar.unpacked');
      const originalUnpacked = join(resources, `${originalAsarName}.unpacked`);
      if (status.state === 'clean' || (status.state === 'foreign' && force) || (status.state === 'needs-repair' && status.stale)) {
        if (existsSync(original)) rmSync(original, { force: true });
        // After an update, the new unpacked files replace the old ones; without new ones, keep the old.
        if (existsSync(originalUnpacked) && existsSync(unpacked)) rmSync(originalUnpacked, { recursive: true, force: true });
        onStep('Moving the original app aside');
        renameSync(appAsar, original);
        if (existsSync(unpacked)) {
          try {
            renameSync(unpacked, originalUnpacked);
          } catch (cause) {
            renameSync(original, appAsar);
            throw cause;
          }
        }
      } else if (status.state === 'needs-repair' && !existsSync(appAsar) && existsSync(original)) {
        onStep('Recovering a half-finished install');
      } else if (status.state === 'needs-repair' && !existsSync(original)) {
        throw new InstallError(`The original app (${originalAsarName}) is missing, so it can't be restored`, { code: 'BROKEN', hint: 'Reinstall the desktop app, then install again.' });
      }
      const originalPkg = readPackage(original);
      if (!originalPkg || (originalPkg.name !== target.packageName && !force)) {
        throw new InstallError(`${originalAsarName} isn't the desktop app (${originalPkg?.name ?? 'unreadable'})`, { code: 'BROKEN' });
      }
      onStep('Writing the launcher');
      const marker = writeStub(resources, { manifest, payloadDir, originalPkg });
      writeFileSync(join(dir, 'install.json'), JSON.stringify({ resources, installedAt: marker.installedAt, version: manifest.version, appVersion: originalPkg.version }, null, 2));
      onStep('Done');
      return { resources, payloadDir, dataDir: dir, marker, appVersion: originalPkg.version, previous: status.state };
    } catch (cause) {
      throw permissionError(cause, resources);
    }
  });
}

/**
 * Removes the client app from one install and puts the original app back. With `purge`, also deletes
 * the client app's data (installed plugins, themes, settings); otherwise they're kept for next time.
 */
export function uninstall({ resources, target = defaultTarget, id = null, purge = false, dataDir, onStep = () => {} }) {
  return withLock(resources, () => {
    const status = inspect(resources, { target });
    if (status.state === 'clean') return { resources, removed: false, reason: 'Nothing is installed' };
    if (status.state === 'foreign') throw new InstallError(status.reason, { code: 'FOREIGN' });
    if (status.state === 'missing') throw new InstallError(`No desktop app in ${resources}`, { code: 'NOT_FOUND' });
    const marker = status.marker ?? null;
    if (id && marker && marker.id !== id) throw new InstallError(`${marker.name ?? marker.id} is installed, not ${id}`, { code: 'OTHER_CLIENT' });
    const appAsar = join(resources, 'app.asar');
    const original = join(resources, originalAsarName);
    const unpacked = join(resources, 'app.asar.unpacked');
    const originalUnpacked = join(resources, `${originalAsarName}.unpacked`);
    try {
      if (existsSync(original)) {
        const pkg = readPackage(original);
        if (pkg?.name !== target.packageName) throw new InstallError(`${originalAsarName} isn't the desktop app; not restoring it`, { code: 'BROKEN' });
        onStep('Restoring the original app');
        if (status.stale) {
          rmSync(original, { force: true });
          if (existsSync(originalUnpacked)) {
            if (existsSync(unpacked)) rmSync(originalUnpacked, { recursive: true, force: true });
            else renameSync(originalUnpacked, unpacked);
          }
        } else {
          rmSync(appAsar, { force: true });
          renameSync(original, appAsar);
          if (existsSync(originalUnpacked)) {
            rmSync(unpacked, { recursive: true, force: true });
            renameSync(originalUnpacked, unpacked);
          }
        }
      }
      const clientId = marker?.id ?? id;
      const dir = dataDir ?? (marker?.payloadDir ? join(marker.payloadDir, '..') : clientId ? defaultDataDir(clientId) : null);
      if (dir && existsSync(dir)) {
        if (purge) {
          onStep('Deleting the client app’s data');
          rmSync(dir, { recursive: true, force: true });
        } else {
          rmSync(join(dir, 'app'), { recursive: true, force: true });
          rmSync(join(dir, 'install.json'), { force: true });
        }
      }
      onStep('Done');
      return { resources, removed: true, purged: purge };
    } catch (cause) {
      throw permissionError(cause, resources);
    }
  });
}

/**
 * Puts the client app back after the desktop app updated itself (updates replace app.asar), rewrites
 * an outdated launcher, or finishes a half-done install. Uses the payload already installed unless a
 * new one is given.
 */
export function repair({ resources, payload, target = defaultTarget, id, dataDir, onStep = () => {} }) {
  const dir = dataDir ?? (id ? defaultDataDir(id) : null);
  const source = payload ?? (dir ? join(dir, 'app') : null);
  if (!source || !existsSync(join(source, 'manifest.json'))) throw new InstallError('There is no installed client app to repair; install it again', { code: 'NOT_INSTALLED' });
  const status = inspect(resources, { target });
  if (status.state === 'installed' && status.stubVersion >= STUB_VERSION && !payload) return { resources, repaired: false, reason: 'Nothing to repair' };
  if (payload) return install({ resources, payload, target, dataDir: dir, onStep });
  const tmp = join(dir, 'app.repair');
  rmSync(tmp, { recursive: true, force: true });
  cpSync(source, tmp, { recursive: true });
  try {
    return { ...install({ resources, payload: tmp, target, dataDir: dir, onStep }), repaired: true };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
