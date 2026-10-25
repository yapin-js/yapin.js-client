import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LAUNCHER_SOURCE = join(HERE, '..', 'installer', 'windows', 'launcher.cs');
/** Built from launcher.cs with placeholder names, for builds on machines without csc.exe. */
export const PREBUILT_LAUNCHER = join(HERE, '..', 'installer', 'windows', 'launcher.exe');
const MAGIC = Buffer.from('YAPINCLIENTPKG01', 'ascii');

/** The C# compiler that ships with the .NET Framework on Windows, or null. */
export function findCsc(env = process.env) {
  if (process.platform !== 'win32') return null;
  const windir = env.WINDIR ?? env.windir ?? 'C:\\Windows';
  for (const framework of ['Framework64', 'Framework']) {
    const csc = join(windir, 'Microsoft.NET', framework, 'v4.0.30319', 'csc.exe');
    if (existsSync(csc)) return csc;
  }
  return null;
}

/** A Windows .ico holding one PNG (Windows Vista and later read PNG icons). The PNG must be at most 256 px. */
export function pngToIco(png) {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('The icon must be a PNG');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width > 256 || height > 256) throw new Error(`The icon is ${width}×${height}; Windows icons can be at most 256×256`);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(width === 256 ? 0 : width, 6);
  header.writeUInt8(height === 256 ? 0 : height, 7);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

/** "1.2.3-beta.1" → "1.2.3.0", the four-number form Windows file versions need. */
export function fileVersion(version) {
  const parts = String(version).split(/[-+]/)[0].split('.').map((n) => Math.min(65535, Number.parseInt(n, 10) || 0));
  while (parts.length < 4) parts.push(0);
  return parts.slice(0, 4).join('.');
}

function csString(text) {
  return String(text ?? '').replace(/[\\"]/g, (c) => `\\${c}`).replace(/[\r\n]+/g, ' ').slice(0, 200);
}

/**
 * Compiles the launcher with the client app's name, version and icon in its file properties.
 * Throws if csc.exe isn't available (use the prebuilt launcher then).
 */
export function compileLauncher({ out, name, version, description = '', company = '', icon = null, csc = findCsc() }) {
  if (!csc) throw new Error('csc.exe not found (it comes with the .NET Framework on Windows)');
  const work = mkdtempSync(join(tmpdir(), 'yc-launcher-'));
  try {
    const source = readFileSync(LAUNCHER_SOURCE, 'utf8')
      .replaceAll('__TITLE__', csString(`${name} installer`))
      .replaceAll('__PRODUCT__', csString(name))
      .replaceAll('__DESCRIPTION__', csString(description || `Installs ${name} into the Yapin’ desktop app`))
      .replaceAll('__COMPANY__', csString(company))
      .replaceAll('__COPYRIGHT__', csString(company ? `© ${new Date().getFullYear()} ${company}` : ''))
      .replaceAll('__FILEVERSION__', fileVersion(version))
      .replaceAll('__VERSION__', csString(version));
    const sourceFile = join(work, 'launcher.cs');
    writeFileSync(sourceFile, source);
    const args = ['/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', `/out:${out}`, '/r:System.Windows.Forms.dll', '/utf8output'];
    if (icon) {
      const ico = join(work, 'icon.ico');
      writeFileSync(ico, /\.ico$/i.test(icon) ? readFileSync(icon) : pngToIco(readFileSync(icon)));
      args.push(`/win32icon:${ico}`);
    }
    args.push(sourceFile);
    try {
      execFileSync(csc, args, { stdio: 'pipe', windowsHide: true });
    } catch (error) {
      throw new Error(`Compiling the launcher failed: ${String(error.stdout ?? '') || error.message}`);
    }
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Every file under `dir` as { 'relative/path': Buffer }. */
function collect(dir, skip = () => false) {
  const files = {};
  const walk = (folder) => {
    for (const name of readdirSync(folder).sort()) {
      const full = join(folder, name);
      const rel = relative(dir, full).split(sep).join('/');
      if (skip(rel)) continue;
      if (statSync(full).isDirectory()) walk(full);
      else files[rel] = readFileSync(full);
    }
  };
  walk(dir);
  return files;
}

/**
 * The bundle format the launcher reads: gzip of [count][name length, name, data length, data]…, then an
 * 8-byte length and a 16-byte magic string. All integers little-endian.
 */
export function createBundle(files) {
  const parts = [];
  const count = Buffer.alloc(4);
  count.writeInt32LE(Object.keys(files).length);
  parts.push(count);
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const lengths = Buffer.alloc(4);
    lengths.writeInt32LE(nameBytes.length);
    const dataLength = Buffer.alloc(4);
    dataLength.writeInt32LE(data.length);
    parts.push(lengths, nameBytes, dataLength, Buffer.from(data));
  }
  const compressed = gzipSync(Buffer.concat(parts), { level: 9 });
  const length = Buffer.alloc(8);
  length.writeBigInt64LE(BigInt(compressed.length));
  return Buffer.concat([compressed, length, MAGIC]);
}

/** Reads a bundle back (from a setup .exe or a bare bundle). The same search the launcher does. */
export function readBundle(data) {
  let end = data.length;
  if (data.length > 0x40 && data.readUInt16LE(0) === 0x5a4d) {
    const pe = data.readInt32LE(0x3c);
    const entry = pe + 24 + (pe + 26 <= data.length && data.readUInt16LE(pe + 24) === 0x20b ? 112 : 96) + 32;
    if (pe > 0 && entry + 8 <= data.length) {
      const certOffset = data.readUInt32LE(entry);
      const certSize = data.readUInt32LE(entry + 4);
      if (certSize > 0 && certOffset > 0 && certOffset <= data.length) end = certOffset;
    }
  }
  for (let trailer = end - 24; trailer >= Math.max(0, end - 40); trailer--) {
    if (!data.subarray(trailer + 8, trailer + 24).equals(MAGIC)) continue;
    const length = Number(data.readBigInt64LE(trailer));
    const plain = gunzipSync(data.subarray(trailer - length, trailer));
    const files = {};
    let offset = 4;
    const count = plain.readInt32LE(0);
    for (let i = 0; i < count; i++) {
      const nameLength = plain.readInt32LE(offset);
      const name = plain.subarray(offset + 4, offset + 4 + nameLength).toString('utf8');
      offset += 4 + nameLength;
      const dataLength = plain.readInt32LE(offset);
      files[name] = plain.subarray(offset + 4, offset + 4 + dataLength);
      offset += 4 + dataLength;
    }
    return files;
  }
  return null;
}

/**
 * Builds `out`: the launcher with the installer folder appended. `meta` tells the launcher the app's
 * name and id, and where else to look for the desktop app (`exe`: paths separated by |).
 */
export function createSetupExe({ launcher, installerDir, out, meta, skip }) {
  const files = collect(installerDir, skip);
  files['__meta.txt'] = Buffer.from(Object.entries(meta).map(([k, v]) => `${k}=${String(v).replace(/[\r\n]+/g, ' ')}`).join('\n'), 'utf8');
  writeFileSync(out, Buffer.concat([readFileSync(launcher), createBundle(files)]));
  return out;
}

/** Runs the signing command from the config, with {file} replaced by the .exe's path. */
export function signFile(command, file) {
  execSync(command.replaceAll('{file}', `"${file}"`), { stdio: 'pipe', windowsHide: true });
}
