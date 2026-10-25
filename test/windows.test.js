import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { createBundle, createSetupExe, fileVersion, findCsc, pngToIco, PREBUILT_LAUNCHER, readBundle, compileLauncher } from '../src/build/windows.js';


const run = promisify(execFile);

/** A valid w×h PNG (one transparent pixel row repeated). */
function png(width, height) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('png icons become ico files', () => {
  const ico = pngToIco(png(64, 64));
  assert.equal(ico.readUInt16LE(2), 1, 'icon type');
  assert.equal(ico.readUInt16LE(4), 1, 'one image');
  assert.equal(ico[6], 64);
  assert.equal(ico.readUInt32LE(18), 22, 'image data right after the header');
  assert.equal(pngToIco(png(256, 256))[6], 0, '256 is written as 0');
  assert.throws(() => pngToIco(png(512, 512)), /at most 256/);
  assert.throws(() => pngToIco(Buffer.from('GIF89a........................')), /must be a PNG/);
});

test('windows file versions have four numbers', () => {
  assert.equal(fileVersion('1.2.3'), '1.2.3.0');
  assert.equal(fileVersion('1.2.3-beta.4'), '1.2.3.0');
  assert.equal(fileVersion('99999.1'), '65535.1.0.0');
});

test('bundles round trip, also with a signature appended to the exe', () => {
  const files = { 'installer.mjs': Buffer.from('console.log(1)'), 'payload/runtime.js': Buffer.from('x'.repeat(5000)), '__meta.txt': Buffer.from('id=a') };
  const bare = readBundle(createBundle(files));
  assert.deepEqual(Object.keys(bare), Object.keys(files));
  assert.equal(bare['payload/runtime.js'].toString(), 'x'.repeat(5000));

  const exe = Buffer.concat([readFileSync(PREBUILT_LAUNCHER), createBundle(files)]);
  assert.ok(readBundle(exe)['installer.mjs']);

  // What signtool does: pad to 8 bytes, append the certificate, and point the PE's certificate entry at it.
  const padding = Buffer.alloc((8 - (exe.length % 8)) % 8);
  const certOffset = exe.length + padding.length;
  const signed = Buffer.concat([exe, padding, Buffer.alloc(2048, 0xab)]);
  const pe = signed.readInt32LE(0x3c);
  const entry = pe + 24 + (signed.readUInt16LE(pe + 24) === 0x20b ? 112 : 96) + 32;
  signed.writeUInt32LE(certOffset, entry);
  signed.writeUInt32LE(2048, entry + 4);
  assert.equal(readBundle(signed)['installer.mjs'].toString(), 'console.log(1)');
  assert.equal(readBundle(Buffer.from('MZ not an installer at all, just some bytes......')), null);
});

const windows = process.platform === 'win32';

test('the setup .exe extracts itself and runs the installer', { skip: !windows && 'Windows only' }, async () => {
  const work = mkdtempSync(join(tmpdir(), 'yc-exe-'));
  const installerDir = join(work, 'installer');
  mkdirSync(join(installerDir, 'payload'), { recursive: true });
  writeFileSync(join(installerDir, 'installer.json'), '{}');
  writeFileSync(join(installerDir, 'payload', 'manifest.json'), '{"id":"x"}');
  writeFileSync(
    join(installerDir, 'installer.mjs'),
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(join(work, 'ran.json'))}, JSON.stringify({ args: process.argv.slice(2), electron: process.env.ELECTRON_RUN_AS_NODE ?? null }));\n`,
  );
  const exe = createSetupExe({ launcher: PREBUILT_LAUNCHER, installerDir, out: join(work, 'setup.exe'), meta: { id: 'demo', name: 'Demo', version: '1.0.0', exe: '' } });

  await run(exe, ['--extract', '--to', join(work, 'extracted'), '--quiet']);
  assert.equal(readFileSync(join(work, 'extracted', 'payload', 'manifest.json'), 'utf8'), '{"id":"x"}');
  assert.ok(!existsSync(join(work, 'extracted', '__meta.txt')));

  await run(exe, ['status', '--yes']);
  const ran = JSON.parse(readFileSync(join(work, 'ran.json'), 'utf8'));
  assert.deepEqual(ran.args, ['status', '--yes'], 'arguments are passed through, without --gui');
});

test('the compiled launcher carries the app name and version', { skip: !findCsc() && 'needs csc.exe' }, async () => {
  const work = mkdtempSync(join(tmpdir(), 'yc-csc-'));
  const iconFile = join(work, 'icon.png');
  writeFileSync(iconFile, png(32, 32));
  const out = compileLauncher({ out: join(work, 'l.exe'), name: 'Nebula "Quotes"', version: '2.3.4-beta.1', company: 'Ada', icon: iconFile });
  const binary = readFileSync(out);
  assert.ok(binary.includes(Buffer.from('2.3.4.0', 'utf16le')), 'file version');
  assert.ok(binary.includes(Buffer.from('Nebula "Quotes"', 'utf16le')), 'product name, with quotes intact');
});
