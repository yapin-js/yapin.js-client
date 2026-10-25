import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The installer's side of the Windows setup wizard (an NSIS installer, see src/build/nsis.js). NSIS runs
 * installer.mjs with `--nsis <file>` and reads the answer back from that file with ReadINIStr:
 *
 *   status --nsis status.ini                 what's installed where
 *   install --nsis result.ini --index 1 ...  also repair and uninstall; prints each step for the log
 *
 * The INI is UTF-16 with a byte order mark, the form Windows' INI functions read as Unicode. Lines for
 * the log are plain ASCII, because nsExec only recognises UTF-16 output.
 */

/** { section: { key: value } } as an INI file. Values are kept on one line. */
export function iniFile(sections) {
  const lines = [];
  for (const [name, values] of Object.entries(sections)) {
    lines.push(`[${name}]`);
    for (const [key, value] of Object.entries(values)) {
      const text = value === true ? '1' : value === false ? '0' : String(value ?? '');
      lines.push(`${key}=${text.replace(/[\r\n]+/g, ' ').trim()}`);
    }
    lines.push('');
  }
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(lines.join('\r\n'), 'utf16le')]);
}

/** The closest ASCII to `text`, for nsExec's log. */
export function asciiLine(text) {
  return String(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

export function statusSections(status) {
  const sections = {
    status: { count: status.installs.length, running: status.running === null ? '' : status.running, hasData: status.hasData },
  };
  status.installs.forEach((inst, i) => {
    sections[`install${i}`] = {
      location: inst.location,
      appVersion: inst.appVersion ?? '',
      state: inst.state,
      ours: Boolean(inst.installed?.ours),
      installedName: inst.installed?.name ?? '',
      installedVersion: inst.installed?.version ?? '',
      canInstall: inst.canInstall,
      blocked: inst.blocked ?? '',
      executable: inst.executable ?? '',
      folder: inst.executable ? dirname(inst.executable) : '',
    };
  });
  return sections;
}

export async function runNsis({ operations, command, options = {}, file, log = (line) => console.log(line) }) {
  if (command === 'status') {
    writeFileSync(file, iniFile(statusSections(await operations.status())));
    return 0;
  }
  if (!['install', 'repair', 'uninstall'].includes(command)) {
    writeFileSync(file, iniFile({ result: { ok: false, error: `Unknown command "${command}"` } }));
    return 1;
  }
  const index = options.index === undefined ? 0 : Number(options.index) - 1;
  const result = await operations[command]({ index, close: options.close === true, purge: options.purge === true, launch: false, onStep: (step) => log(asciiLine(step)) });
  writeFileSync(file, iniFile({ result: { ok: result.ok, error: result.error ?? '', hint: result.hint ?? '', previous: result.result?.previous ?? '' } }));
  return result.ok ? 0 : 1;
}
