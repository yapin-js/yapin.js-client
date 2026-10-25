import { readFileSync } from 'node:fs';

/**
 * Electron fuses: build-time switches baked into the app's executable. Two of them decide whether a
 * client mod can be installed at all:
 * - EnableEmbeddedAsarIntegrityValidation: the app checks app.asar against a hash in the executable, so
 *   a replaced app.asar won't start. Installing is refused when this is on.
 * - OnlyLoadAppFromAsar: the app ignores a resources/app folder. Doesn't matter here, since the installer
 *   always writes an app.asar.
 */
const SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');

export const FuseNames = Object.freeze([
  'RunAsNode',
  'EnableCookieEncryption',
  'EnableNodeOptionsEnvironmentVariable',
  'EnableNodeCliInspectArguments',
  'EnableEmbeddedAsarIntegrityValidation',
  'OnlyLoadAppFromAsar',
  'LoadBrowserProcessSpecificV8Snapshot',
  'GrantFileProtocolExtraPrivileges',
  'WasmTrapHandlers',
]);

/** Reads the fuses from an executable (or its bytes). null if the binary has no fuse wire. */
export function readFuses(fileOrBuffer) {
  const data = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : readFileSync(fileOrBuffer);
  const at = data.indexOf(SENTINEL);
  if (at < 0) return null;
  const version = data[at + SENTINEL.length];
  const count = data[at + SENTINEL.length + 1];
  const fuses = {};
  for (let i = 0; i < count; i++) {
    const byte = data[at + SENTINEL.length + 2 + i];
    const name = FuseNames[i] ?? `Fuse${i}`;
    fuses[name] = byte === 0x31 ? true : byte === 0x30 ? false : null;
  }
  return { version, fuses };
}

/** Whether a client mod can be installed into an app with these fuses, and why not. */
export function checkFuses(result) {
  if (!result) return { ok: true, reason: null };
  if (result.fuses.EnableEmbeddedAsarIntegrityValidation === true) {
    return { ok: false, reason: 'This version of the desktop app checks its files for changes (asar integrity validation), so client mods cannot be installed into it.' };
  }
  return { ok: true, reason: null };
}
