import { closeSync, openSync, readSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Electron's asar archive format, read and written without the asar package.
 *
 * Layout: an 8-byte pickle holding the header size, then the header (a pickle holding a length-prefixed
 * JSON string padded to 4 bytes), then the file contents back to back. The JSON is a tree of
 * `{ files: { name: { size, offset, integrity? } | { files } } }`; offsets are strings, relative to the
 * end of the header.
 */

function align4(n) {
  return n + ((4 - (n % 4)) % 4);
}

/** Reads the header of an asar file: { header, base } where file data starts at `base`. */
export function readHeader(file) {
  const fd = openSync(file, 'r');
  try {
    const size = Buffer.alloc(8);
    if (readSync(fd, size, 0, 8, 0) !== 8) throw new Error(`${file} is not an asar archive (too short)`);
    const headerPickleSize = size.readUInt32LE(4);
    if (headerPickleSize < 8 || headerPickleSize > statSync(file).size) throw new Error(`${file} is not an asar archive (bad header size)`);
    const pickle = Buffer.alloc(headerPickleSize);
    readSync(fd, pickle, 0, headerPickleSize, 8);
    const stringLength = pickle.readUInt32LE(4);
    if (stringLength + 8 > headerPickleSize) throw new Error(`${file} is not an asar archive (bad header)`);
    const header = JSON.parse(pickle.subarray(8, 8 + stringLength).toString('utf8'));
    return { header, base: 8 + headerPickleSize };
  } finally {
    closeSync(fd);
  }
}

/** Every file in the archive: [{ path, size, offset, unpacked, executable }]. */
export function listFiles(file) {
  const { header } = readHeader(file);
  const out = [];
  const walk = (node, prefix) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const full = prefix ? `${prefix}/${name}` : name;
      if (entry.files) walk(entry, full);
      else if (!entry.link) out.push({ path: full, size: entry.size, offset: entry.offset === undefined ? null : Number(entry.offset), unpacked: Boolean(entry.unpacked), executable: Boolean(entry.executable) });
    }
  };
  walk(header, '');
  return out;
}

/** The contents of one file in the archive (null if it isn't there or is unpacked). */
export function readFile(file, inner) {
  const { header, base } = readHeader(file);
  let node = header;
  for (const part of inner.split('/')) {
    node = node?.files?.[part];
    if (!node) return null;
  }
  if (node.files || node.unpacked || node.offset === undefined) return null;
  const fd = openSync(file, 'r');
  try {
    const out = Buffer.alloc(node.size);
    readSync(fd, out, 0, node.size, base + Number(node.offset));
    return out;
  } finally {
    closeSync(fd);
  }
}

/**
 * Builds an archive from { 'path/in/archive': Buffer | string }. Returns the bytes; with `out`, also
 * writes them there.
 */
export function createArchive(files, out) {
  const root = { files: {} };
  const chunks = [];
  let offset = 0;
  for (const [path, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const parts = path.split('/').filter(Boolean);
    let node = root;
    for (const dir of parts.slice(0, -1)) node = node.files[dir] ??= { files: {} };
    const hash = createHash('sha256').update(data).digest('hex');
    node.files[parts[parts.length - 1]] = {
      size: data.length,
      offset: String(offset),
      integrity: { algorithm: 'SHA256', hash, blockSize: 4 * 1024 * 1024, blocks: [hash] },
    };
    chunks.push(data);
    offset += data.length;
  }
  const json = Buffer.from(JSON.stringify(root), 'utf8');
  const headerPickle = Buffer.alloc(8 + align4(json.length));
  headerPickle.writeUInt32LE(4 + align4(json.length), 0);
  headerPickle.writeUInt32LE(json.length, 4);
  json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  const archive = Buffer.concat([sizePickle, headerPickle, ...chunks]);
  if (out) writeFileSync(out, archive);
  return archive;
}
