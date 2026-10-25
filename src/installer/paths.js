import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the Yapin’ desktop app is installed on each platform, and where client apps keep their data.
 * All of it can be overridden from the installer config (`installer.target`), in case Yapin’ moves
 * things.
 */
export const defaultTarget = Object.freeze({
  /** package.json "name" inside the app's app.asar; used to recognise a real Yapin’ install. */
  packageName: 'yapper-desktop',
  productName: 'Yapper',
  executable: { win32: 'Yapper.exe', darwin: 'Yapper', linux: 'yapper-desktop' },
  processName: { win32: 'Yapper.exe', darwin: 'Yapper', linux: 'yapper-desktop' },
  /** Folders that hold `resources/app.asar`. `~` and %VAR% / $VAR are expanded. */
  locations: {
    win32: ['%LOCALAPPDATA%\\Programs\\yapper-desktop', '%PROGRAMFILES%\\Yapper', '%PROGRAMFILES%\\yapper-desktop'],
    darwin: ['/Applications/Yapper.app/Contents', '~/Applications/Yapper.app/Contents'],
    linux: ['/opt/Yapper', '/opt/yapper-desktop', '/usr/lib/yapper-desktop', '/usr/share/yapper-desktop', '~/.local/share/yapper-desktop'],
  },
});

export function expandPath(p, env = process.env) {
  return String(p)
    .replace(/^~(?=$|[\\/])/, homedir())
    .replace(/%([A-Za-z0-9_]+)%/g, (whole, name) => env[name] ?? env[Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase())] ?? whole)
    .replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (whole, name) => env[name] ?? whole);
}

/** The folder client apps keep their files in: <appData>/yapin-client/<id>. */
export function dataDir(id, { platform = process.platform, env = process.env } = {}) {
  let base;
  if (platform === 'win32') base = env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  else if (platform === 'darwin') base = join(homedir(), 'Library', 'Application Support');
  else base = env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'yapin-client', id);
}

/** The resources folder inside an install location (macOS app bundles call it Resources). */
export function resourcesDir(location) {
  for (const name of ['resources', 'Resources']) {
    const dir = join(location, name);
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  }
  return null;
}

/** The app's executable in an install location. */
export function executablePath(location, target = defaultTarget, platform = process.platform) {
  const name = target.executable?.[platform];
  if (!name) return null;
  const candidates = platform === 'darwin' ? [join(location, 'MacOS', name)] : [join(location, name)];
  if (platform === 'linux') {
    try {
      for (const entry of readdirSync(location)) if (entry.toLowerCase() === name.toLowerCase()) candidates.push(join(location, entry));
    } catch {
      // folder gone
    }
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}
