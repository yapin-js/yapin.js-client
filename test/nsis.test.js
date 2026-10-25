import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import { decodePng, findMakensis, headerBitmap, nsisScript, nsisString, nsisVars, plainText, sidebarBitmap, toBmp, welcomeText, wizardStrings } from '../src/build/nsis.js';
import { asciiLine, iniFile, runNsis, statusSections } from '../src/installer/nsis.js';
import { createArchive } from '../src/installer/asar.js';
import { loadConfig } from '../src/config/load.js';
import { build } from '../src/build/build.js';

const run = promisify(execFile);
const tmp = (prefix = 'yc-nsis-') => mkdtempSync(join(tmpdir(), prefix));
const readIni = (file) => readFileSync(file).subarray(2).toString('utf16le');

/** Encodes RGBA as a PNG, using each of the five row filters in turn so the decoder meets them all. */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const rows = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const filter = y % 5;
    rows[y * (stride + 1)] = filter;
    for (let x = 0; x < stride; x++) {
      const raw = rgba[y * stride + x];
      const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const corner = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      const p = left + up - corner;
      const paeth = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - up) <= Math.abs(p - corner) ? up : corner;
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter];
      rows[y * (stride + 1) + 1 + x] = (raw - predicted) & 0xff;
    }
  }
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
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('the INI the wizard reads is UTF-16 with a byte order mark, one line per value', () => {
  const file = iniFile({ result: { ok: true, error: 'Bad\nthing ’here’', hint: null } });
  assert.deepEqual([...file.subarray(0, 2)], [0xff, 0xfe]);
  assert.equal(file.subarray(2).toString('utf16le'), '[result]\r\nok=1\r\nerror=Bad thing ’here’\r\nhint=\r\n');
  assert.equal(asciiLine('Deleting the client app’s data…'), "Deleting the client app's data...");
  assert.equal(asciiLine('Café ✔'), 'Cafe ?');
});

test('status for the wizard lists each install', () => {
  const sections = statusSections({
    running: null,
    hasData: true,
    installs: [{ location: 'C:\\A', appVersion: '1.1.0', state: 'installed', installed: { name: 'N', version: '2', ours: true }, canInstall: true, blocked: null, executable: 'C:\\A\\Yapper.exe' }],
  });
  assert.deepEqual(sections.status, { count: 1, running: '', hasData: true });
  assert.equal(sections.install0.ours, true);
  assert.equal(sections.install0.folder, 'C:\\A');
});

test('runNsis writes status and results, and logs steps as they happen', async () => {
  const dir = tmp();
  const calls = [];
  const operations = {
    status: async () => ({ running: false, hasData: false, installs: [] }),
    install: async (args) => {
      calls.push(args);
      args.onStep('Copying files…');
      return { ok: false, steps: ['Copying files…'], error: 'Disk full', hint: 'Free some space' };
    },
  };
  assert.equal(await runNsis({ operations, command: 'status', file: join(dir, 's.ini') }), 0);
  assert.match(readIni(join(dir, 's.ini')), /count=0/);

  const lines = [];
  const code = await runNsis({ operations, command: 'install', options: { index: '2', close: true, purge: true }, file: join(dir, 'r.ini'), log: (line) => lines.push(line) });
  assert.equal(code, 1);
  assert.deepEqual(lines, ['Copying files...']);
  assert.equal(calls[0].index, 1, '--index is 1-based');
  assert.equal(calls[0].close, true);
  assert.equal(calls[0].launch, false, 'the wizard starts the app itself, from the Finish page');
  assert.match(readIni(join(dir, 'r.ini')), /ok=0\r\nerror=Disk full\r\nhint=Free some space/);
  assert.equal(await runNsis({ operations, command: 'nope', file: join(dir, 'x.ini') }), 1);
});

test('NSIS strings escape $, quotes and newlines; variables can be kept', () => {
  assert.equal(nsisString('Cost $5 "now"\nok\tgo'), '"Cost $$5 $\\"now$\\"$\\r$\\nok$\\tgo"');
  assert.equal(nsisString('x'.repeat(2000)).length, 1002);
  assert.equal(nsisVars('A $1 ', ['$R3'], ' "b"'), '"A $$1 $R3 $\\"b$\\""');
  assert.equal(plainText('**Bold**, *it*, `code` and [a link](https://x.y)'), 'Bold, it, code and a link');
});

test('PNG logos decode with every row filter, and bitmaps come out the size NSIS wants', () => {
  const width = 7;
  const height = 10;
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37 + (i >> 3) * 11) & 0xff;
  const image = decodePng(encodePng(width, height, rgba));
  assert.equal(image.width, width);
  assert.ok(image.rgba.equals(rgba));
  assert.equal(decodePng(Buffer.from('not a png at all, not at all, not at all')), null);

  const bmp = toBmp({ width: 3, height: 2, rgb: Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9]) });
  assert.equal(bmp.toString('ascii', 0, 2), 'BM');
  assert.equal(bmp.length, 54 + 12 * 2, 'rows are padded to 4 bytes');
  assert.deepEqual([...bmp.subarray(54, 57)], [3, 2, 1], 'bottom row first, as BGR');
  assert.deepEqual([...bmp.subarray(66, 69)], [0, 0, 255]);

  const logo = { width: 2, height: 2, rgba: Buffer.alloc(16, 255) };
  const sidebar = sidebarBitmap({ accent: '#8b5cf6', logo });
  assert.equal(sidebar.readInt32LE(18), 164);
  assert.equal(sidebar.readInt32LE(22), 314);
  assert.equal(headerBitmap({ logo: null }).readInt32LE(18), 150);
});

test('the wizard script has the pages, the texts and the close behaviour from the config', () => {
  const installer = {
    app: { id: 'nebula', name: 'Nebula', version: '1.4.0' },
    marketing: { description: 'Adds **themes**.', terms: { title: 'License', text: 'MIT' }, strings: { setupWelcomeTitle: 'Hi from {name} {version}' } },
    closeApp: 'never',
    launchAfter: false,
  };
  const files = { sidebar: 's.bmp', header: 'h.bmp', icon: 'i.ico', license: 'l.txt' };
  const script = nsisScript({ installer, source: 'C:\\out\\installer', out: 'C:\\out\\setup.exe', files, company: 'Ada', exeLocations: ['%LOCALAPPDATA%\\Programs\\yapper-desktop\\Yapper.exe'] });
  for (const needle of ['MUI_PAGE_WELCOME', 'MUI_PAGE_LICENSE "l.txt"', 'MUI_LICENSEPAGE_CHECKBOX', 'Page custom ChoosePage ChooseLeave', 'MUI_PAGE_INSTFILES', 'MUI_PAGE_FINISH', 'MUI_FINISHPAGE_RUN_NOTCHECKED', 'RequestExecutionLevel user', '"Hi from Nebula 1.4.0"', 'VIProductVersion "1.4.0.0"', 'ExpandEnvStrings $R0 "%LOCALAPPDATA%\\Programs\\yapper-desktop\\Yapper.exe"']) {
    assert.ok(script.includes(needle), needle);
  }
  assert.ok(!script.includes(' --close'), 'closeApp "never" never closes the app');
  assert.ok(script.includes('Close it (check the system tray too)'));
  assert.ok(!/\$\{(?!If|Else|EndIf|AndIf|OrIf|IfNot|DoWhile|Loop|NSD_|BST_|SW_|WM_|FileExists|Errors|GetParameters|GetOptions)/.test(script), 'no JS placeholders left over');
  assert.match(welcomeText(installer), /Adds themes\./);

  const plain = nsisScript({ installer: { ...installer, closeApp: 'ask', marketing: {}, launchAfter: true }, source: 'x', out: 'y', files: { ...files, license: null } });
  assert.ok(!plain.includes('MUI_PAGE_LICENSE'));
  assert.ok(plain.includes(' --close'));
  assert.ok(plain.includes('MB_ICONQUESTION|MB_OKCANCEL'));
  assert.equal(wizardStrings({ app: { name: 'N', version: '2' }, marketing: {} }).setupInstall, 'Install N 2');
});

const makensis = findMakensis();

test('the setup wizard builds, installs silently, and uninstalls with /UNINSTALL', { skip: !makensis && 'needs NSIS' }, async () => {
  const project = tmp('yc-nsis-project-');
  cpSync(fileURLToPath(new URL('./fixtures/sample', import.meta.url)), project, { recursive: true });
  const app = tmp('yc-nsis-app-');
  mkdirSync(join(app, 'resources'));
  createArchive({ 'package.json': JSON.stringify({ name: 'yapper-desktop', version: '1.1.0', main: 'main.js' }), 'main.js': '' }, join(app, 'resources', 'app.asar'));

  const { config, root } = await loadConfig({ cwd: project });
  config.installer.target = { locations: { win32: [app] }, processName: { win32: 'yc-not-running.exe' } };
  const result = await build(config, { root });
  assert.equal(result.exeKind, 'nsis');
  assert.equal(readFileSync(result.exeFile).toString('ascii', 0, 2), 'MZ');
  if (process.platform !== 'win32') return; // built fine; running it needs Windows

  // APPDATA points somewhere temporary so the test leaves the real one alone.
  const env = { ...process.env, APPDATA: tmp('yc-nsis-data-') };
  await run(result.exeFile, ['/S'], { env });
  assert.ok(existsSync(join(app, 'resources', '_app.asar')), 'the original app was moved aside');
  assert.ok(existsSync(join(env.APPDATA, 'yapin-client', 'sample-client', 'install.json')));

  await run(result.exeFile, ['/S', '/UNINSTALL', '/PURGE'], { env });
  assert.ok(!existsSync(join(app, 'resources', '_app.asar')), 'the original app is back');
  assert.ok(!existsSync(join(env.APPDATA, 'yapin-client', 'sample-client')), '/PURGE deleted the data');
});
