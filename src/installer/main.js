import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runCli, style } from './cli.js';
import { runNsis } from './nsis.js';
import { createOperations } from './operations.js';
import { openBrowser, startServer } from './server.js';

// Run with the desktop app's Node (ELECTRON_RUN_AS_NODE), Electron still treats .asar files as folders.
// The installer reads and writes them as plain files, so that has to be off.
if (process.versions.electron) process.noAsar = true;

/**
 * The installer program shipped with a client app (bundled into installer.mjs by the build). It reads
 * installer.json and payload/ from its own folder. Run by the install.cmd / install.sh launchers with
 * the desktop app's built-in Node, so the people installing need nothing else.
 *
 *   installer.mjs                 opens the installer page in the browser
 *   installer.mjs --cli           the same in the terminal
 *   installer.mjs install --yes   no questions (also repair, uninstall [--purge], status)
 */
const HELP = `Usage: install [command] [options]

Commands:
  install      Install or update
  repair       Put it back after the desktop app updated
  uninstall    Remove it (--purge also deletes installed plugins, themes and settings)
  status       Show what's installed where

Options:
  --cli          Use the terminal instead of the browser
  --gui          Use the browser even without a terminal
  --yes, -y      Answer yes to every question
  --close        Close the desktop app without asking
  --path <dir>   The desktop app's folder, if it isn't found on its own
  --index <n>    Which install to use when there are several (1, 2, …)
  --purge        With uninstall: delete data too
  --no-launch    Don't reopen the desktop app afterwards
  --help, -h     Show this`;

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      cli: { type: 'boolean' },
      gui: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      close: { type: 'boolean' },
      purge: { type: 'boolean' },
      'no-launch': { type: 'boolean' },
      path: { type: 'string', multiple: true },
      index: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      nsis: { type: 'string' },
    },
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const installer = JSON.parse(readFileSync(join(here, 'installer.json'), 'utf8'));
  const operations = createOperations({ config: installer, payload: join(here, 'payload'), extraLocations: values.path ?? [] });
  const command = positionals[0];
  const options = { yes: values.yes, close: values.close, purge: values.purge, index: values.index, launch: values['no-launch'] ? false : undefined };

  // The Windows setup wizard (NSIS) asks with --nsis <file> and reads the answer from that file.
  if (values.nsis) return runNsis({ operations, command, options, file: values.nsis });

  // The Windows setup .exe passes --gui: it has no terminal, but the page doesn't need one.
  if (values.cli || command || installer.gui === false || (!process.stdout.isTTY && !values.gui)) {
    return runCli({ installer, operations, command, options });
  }

  const server = await startServer({ installer, operations, onLog: (line) => console.log(style.dim(line)) });
  console.log('');
  console.log(`  ${style.bold(style.accent(installer.marketing?.title ?? installer.app.name))} installer`);
  console.log('');
  console.log(`  The installer is open in your browser. If it isn't, open this link:`);
  console.log(`  ${style.cyan(server.url)}`);
  console.log('');
  console.log(style.dim('  Keep this window open until you are done. Press Ctrl+C to stop.'));
  if (!openBrowser(server.url)) console.log(style.yellow('  (Could not open the browser by itself.)'));
  process.on('SIGINT', () => server.stop());
  await server.done;
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (error) => {
    console.error(style.red(`The installer failed: ${error?.message ?? error}`));
    process.exitCode = 1;
  },
);
