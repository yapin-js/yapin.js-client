import { createInterface } from 'node:readline/promises';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
const paint = (code) => (text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : String(text));
export const style = { bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'), yellow: paint('33'), accent: paint('35'), cyan: paint('36') };

function stateLabel(inst) {
  if (inst.blocked) return style.red(`can't install: ${inst.blocked}`);
  if (inst.state === 'installed') return style.green(`${inst.installed.name} ${inst.installed.version} installed`);
  if (inst.state === 'needs-repair') return style.yellow('needs repair');
  return style.dim('not installed');
}

function report(result, verb) {
  for (const step of result.steps) console.log(style.dim(`  · ${step}`));
  if (result.ok) {
    console.log(style.green(`✔ ${verb} finished`));
    return 0;
  }
  console.log(style.red(`✖ ${result.error}`));
  if (result.hint) console.log(`  ${result.hint}`);
  return 1;
}

/**
 * The installer in a terminal: `install`, `repair`, `uninstall` or `status`, or a menu when run with
 * no command. `--yes` answers every question with yes (for scripts).
 */
export async function runCli({ installer, operations, command, options = {} }) {
  const app = installer.app;
  const m = installer.marketing ?? {};
  const ask = async (question, fallback = true) => {
    if (options.yes) return true;
    if (!process.stdin.isTTY) return fallback;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question(`${question} ${fallback ? '[Y/n]' : '[y/N]'} `)).trim().toLowerCase();
      return answer ? answer.startsWith('y') : fallback;
    } finally {
      rl.close();
    }
  };

  console.log('');
  console.log(`  ${style.bold(style.accent(m.title ?? app.name))} ${style.dim(app.version)}`);
  if (m.tagline) console.log(`  ${m.tagline.replace(/[*`]/g, '')}`);
  console.log('');

  const status = await operations.status();
  if (!status.installs.length) {
    console.log(style.red(`Couldn't find the ${operations.target.productName} desktop app on this computer.`));
    console.log('Install it from https://www.yapin.gg, open it once, then run this installer again.');
    return 1;
  }
  status.installs.forEach((inst, i) => console.log(`  ${status.installs.length > 1 ? `${i + 1}) ` : ''}${inst.location} ${style.dim(inst.appVersion ?? '')}  ${stateLabel(inst)}`));
  console.log('');
  if (command === 'status') return 0;

  let index = 0;
  if (options.index !== undefined) index = Number(options.index) - 1;
  else if (status.installs.length > 1 && process.stdin.isTTY && !options.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Which one? [1-${status.installs.length}] `);
    rl.close();
    index = Math.max(0, Math.min(status.installs.length - 1, (Number(answer) || 1) - 1));
  }
  const inst = status.installs[index];

  if (!command) {
    const choices = [];
    if (inst.canInstall) choices.push(['install', inst.state === 'installed' ? 'Update / reinstall' : 'Install']);
    if (inst.state === 'needs-repair') choices.push(['repair', 'Repair']);
    if (inst.installed?.ours || inst.state === 'needs-repair') choices.push(['uninstall', 'Uninstall']);
    if (!choices.length) {
      console.log(style.red(inst.blocked ?? 'Nothing can be done here.'));
      return 1;
    }
    choices.forEach(([, label], i) => console.log(`  ${i + 1}) ${label}`));
    console.log('  q) Quit');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question('> ')).trim().toLowerCase();
    rl.close();
    const picked = choices[Number(answer) - 1];
    if (!picked) return 0;
    command = picked[0];
  }

  let close = installer.closeApp === 'always' || options.close === true;
  if (status.running && !close && installer.closeApp !== 'never') {
    close = await ask(`${operations.target.productName} is running. Close it and continue?`, true);
    if (!close) {
      console.log(`Close ${operations.target.productName}, then run the installer again.`);
      return 1;
    }
  }
  const launch = options.launch ?? (installer.launchAfter !== false && status.running);

  if (command === 'install') return report(await operations.install({ index, close, launch }), 'Install');
  if (command === 'repair') return report(await operations.repair({ index, close, launch }), 'Repair');
  if (command === 'uninstall') {
    const purge = options.purge ?? (status.hasData ? await ask('Also delete installed plugins, themes and settings?', false) : false);
    return report(await operations.uninstall({ index, close, launch, purge }), 'Uninstall');
  }
  console.log(style.red(`Unknown command "${command}" (use install, repair, uninstall or status)`));
  return 1;
}
