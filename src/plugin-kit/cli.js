import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin, indexEntry } from './build.js';
import { checkAgainstManifest, checkFile } from './check.js';
import { describeTarget, installForDev, watchPlugin } from './dev.js';
import { loadManifest, MANIFEST_FILE } from './manifest.js';
import { generateKeys, signText, verifyText } from './sign.js';
import { style } from '../installer/cli.js';
import { apiVersion, version as frameworkVersion } from '../shared/constants.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', '..', 'templates', 'plugin');

const ok = (text) => console.log(style.green(`✔ ${text}`));
const warn = (text) => console.log(style.yellow(`! ${text}`));
const bad = (text) => console.log(style.red(`✖ ${text}`));
const info = (text) => console.log(style.dim(`  ${text}`));
const rel = (file) => relative(process.cwd(), file) || basename(file);

export const PLUGIN_HELP = `yapin-client plugin: build and share one plugin

Usage: yapin-client plugin <command> [options]

Commands:
  init [dir]             Start a plugin project (${MANIFEST_FILE}, src/, README)
  build                  Bundle it into dist/<id>.plugin.js
  dev                    Build into a client app's plugins folder, rebuild on save
  check [file]           Check the project, or one .js / .css file
  sign <file>            Add an @signature line with a signing key
  verify <file>          Check a file's @signature against a public key
  keygen                 Make a new signing key pair
  entry                  Print the registry index entry for this plugin

Options:
  --client <id>          dev: which client app to install into (default: manifest "client")
  --key <file|base64>    sign: the private key; verify: the public key
  --key-id <name>        sign: what to call the key in the signature (default: file name)
  --sign                 build: sign the result (needs --key and --key-id)
  --json                 check / entry: machine-readable output
  -o, --out <file>       keygen / entry: where to write
  -h, --help             Show this`;

/** Prints problems and warnings; returns true when there were no problems. */
function report(label, { problems, warnings }) {
  for (const warning of warnings) warn(warning);
  for (const problem of problems) bad(problem);
  if (problems.length) return false;
  ok(`${label} looks good${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}`);
  return true;
}

function readKey(value, what) {
  if (!value) throw Object.assign(new Error(`--key is required to ${what}`), { hint: 'Make one with: yapin-client plugin keygen' });
  const file = resolve(value);
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : value;
}

function keyIdFor(values) {
  if (values['key-id']) return values['key-id'];
  if (values.key && existsSync(resolve(values.key))) return basename(values.key).replace(/\.(key|pub|pem|txt)$/i, '');
  throw Object.assign(new Error('--key-id is required'), { hint: 'It names the key in a client app\'s plugins.trust list, e.g. --key-id acme-internal.' });
}

export const pluginCommands = {
  init(values, [dir = '.']) {
    const root = resolve(dir);
    mkdirSync(root, { recursive: true });
    if (existsSync(join(root, MANIFEST_FILE))) throw new Error(`${root} already has a ${MANIFEST_FILE}`);
    const id = basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-plugin';
    const name = id.replace(/(^|-)([a-z])/g, (_, dash, c) => `${dash ? ' ' : ''}${c.toUpperCase()}`);
    const client = values.client ?? 'my-client';
    const author = values.author ?? basename(process.env.HOME ?? process.env.USERPROFILE ?? 'you');

    cpSync(TEMPLATES, root, { recursive: true, force: false, errorOnExist: false, filter: (src) => basename(src) !== 'gitignore' });
    if (!existsSync(join(root, '.gitignore'))) writeFileSync(join(root, '.gitignore'), readFileSync(join(TEMPLATES, 'gitignore')));
    const replacements = [['__ID__', id], ['__NAME__', name], ['__AUTHOR__', author], ['__CLIENT__', client], ['__API_VERSION__', String(apiVersion)], ['__FRAMEWORK_VERSION__', frameworkVersion]];
    for (const file of [MANIFEST_FILE, 'README.md', join('src', 'index.js')]) {
      const path = join(root, file);
      if (!existsSync(path)) continue;
      let text = readFileSync(path, 'utf8');
      for (const [from, to] of replacements) text = text.replaceAll(from, to);
      writeFileSync(path, text);
    }
    if (!existsSync(join(root, 'package.json'))) {
      writeFileSync(
        join(root, 'package.json'),
        `${JSON.stringify(
          {
            name: id,
            version: '0.1.0',
            private: true,
            type: 'module',
            scripts: { build: 'yapin-client plugin build', dev: 'yapin-client plugin dev', check: 'yapin-client plugin check' },
            devDependencies: { 'yapin.js-client': `^${frameworkVersion}` },
          },
          null,
          2,
        )}\n`,
      );
    }
    ok(`Created ${name} in ${root}`);
    info(`Next: npm install, then npm run dev (set "client" in ${MANIFEST_FILE} to the client app you're testing in)`);
  },

  build(values) {
    const { manifest, root, warnings } = loadManifest({ file: values.manifest });
    for (const warning of warnings) warn(warning);
    let build = buildPlugin(manifest, { root });
    if (values.sign) {
      const text = signText(build.text, { keyId: keyIdFor(values), privateKey: readKey(values.key, 'sign') });
      writeFileSync(build.file, text);
      build = { ...build, text };
      info(`signed with ${keyIdFor(values)}`);
    }
    const { problems, warnings: fileWarnings } = checkFile(build.file, build.text, { standalone: true });
    for (const warning of fileWarnings) warn(warning);
    for (const problem of problems) bad(problem);
    ok(`${rel(build.file)} (${build.files.length} file${build.files.length === 1 ? '' : 's'}, ${Math.max(1, Math.round(build.bytes / 1024))} kB)`);
    info(`sha256 ${build.sha256}`);
    if (problems.length) process.exitCode = 1;
  },

  async dev(values) {
    const { manifest, root, warnings } = loadManifest({ file: values.manifest });
    for (const warning of warnings) warn(warning);
    const clientId = values.client ?? manifest.client;
    if (!clientId) {
      throw Object.assign(new Error('Which client app should this install into?'), {
        hint: `Set "client" in ${MANIFEST_FILE} to its id, or pass --client <id>.`,
      });
    }
    const first = installForDev(manifest, { root, clientId });
    ok(`${manifest.name} ${manifest.version} installed into ${clientId}`);
    info(describeTarget(manifest, clientId));
    info(`${first.files.length} file${first.files.length === 1 ? '' : 's'}, ${Math.max(1, Math.round(first.bytes / 1024))} kB`);
    info('The desktop app reloads the plugin when it changes. Press Ctrl+C to stop.');
    watchPlugin(manifest, {
      root,
      clientId,
      onBuild: ({ bytes, problems, warnings: fileWarnings }) => {
        for (const warning of fileWarnings) warn(warning);
        for (const problem of problems) bad(problem);
        ok(`rebuilt (${Math.max(1, Math.round(bytes / 1024))} kB)`);
      },
      onError: (error) => bad(error.message),
    });
  },

  check(values, [file]) {
    if (file) {
      const result = checkFile(resolve(file));
      if (values.json) console.log(JSON.stringify({ file: resolve(file), ...result }, null, 2));
      else if (!report(result.meta.name ?? basename(file), result)) process.exitCode = 1;
      else if (result.signature) info(`signed by "${result.signature.keyId}" (${result.signature.algorithm}); run verify to check it`);
      if (values.json && result.problems.length) process.exitCode = 1;
      return;
    }
    const { manifest, root, warnings } = loadManifest({ file: values.manifest });
    const build = buildPlugin(manifest, { root, write: false });
    const result = checkFile(join(manifest.outDir, `${manifest.id}.plugin.js`), build.text, { standalone: true });
    const problems = [...result.problems, ...checkAgainstManifest(manifest, build.text)];
    const all = { problems, warnings: [...warnings, ...result.warnings] };
    if (values.json) {
      console.log(JSON.stringify({ id: manifest.id, version: manifest.version, sha256: build.sha256, ...all }, null, 2));
      if (problems.length) process.exitCode = 1;
      return;
    }
    if (!report(`${manifest.name} ${manifest.version}`, all)) process.exitCode = 1;
  },

  sign(values, [file]) {
    if (!file) throw new Error('Usage: yapin-client plugin sign <file> --key <file> --key-id <name>');
    const path = resolve(file);
    const signed = signText(readFileSync(path, 'utf8'), { keyId: keyIdFor(values), privateKey: readKey(values.key, 'sign') });
    writeFileSync(path, signed);
    ok(`Signed ${rel(path)} as "${keyIdFor(values)}"`);
    info('Clients trust this only once the key is in their plugins.trust list.');
  },

  verify(values, [file]) {
    if (!file) throw new Error('Usage: yapin-client plugin verify <file> --key <public key> [--key-id <name>]');
    const path = resolve(file);
    const text = readFileSync(path, 'utf8');
    const keyId = values['key-id'] ?? null;
    const key = readKey(values.key, 'verify');
    // Without --key-id, accept whatever name the file claims: we're checking the bytes, not the name.
    const claimed = keyId ?? (text.match(/@signature\s+\S+\s+(\S+)/)?.[1] ?? 'unknown');
    const result = verifyText(text, { [claimed]: key });
    const message = {
      valid: () => ok(`${rel(path)} is signed by "${result.keyId}" and the bytes match`),
      unsigned: () => warn(`${rel(path)} has no signature`),
      malformed: () => bad(`${rel(path)} has a signature that can't be read`),
      unknown: () => warn(`${rel(path)} is signed by "${result.keyId}", which isn't the key you gave`),
      // A changed file and the wrong key fail identically, so say both.
      tampered: () => bad(`${rel(path)} doesn't match the signature for "${result.keyId}": it was changed after signing, or that isn't the key it was signed with. Don't install it.`),
    }[result.state];
    message();
    if (result.state !== 'valid') process.exitCode = 1;
  },

  keygen(values) {
    const keys = generateKeys();
    const out = values.out ? resolve(values.out) : null;
    if (!out) {
      console.log(`${style.bold('private key')} (keep secret, never commit)\n${keys.privateKey}\n`);
      console.log(`${style.bold('public key')} (put this in a client app's plugins.trust)\n${keys.publicKey}`);
      return;
    }
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${keys.privateKey}\n`, { mode: 0o600 });
    writeFileSync(`${out}.pub`, `${keys.publicKey}\n`);
    ok(`Wrote ${rel(out)} and ${rel(`${out}.pub`)}`);
    warn('The private key is the whole of your identity as a publisher. Keep it out of git, and in CI use a secret.');
  },

  entry(values) {
    const { manifest, root } = loadManifest({ file: values.manifest });
    const build = buildPlugin(manifest, { root, write: false });
    const entry = indexEntry(manifest, build);
    const text = `${JSON.stringify(entry, null, 2)}\n`;
    if (values.out) {
      const out = resolve(values.out);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, text);
      ok(`Wrote ${rel(out)}`);
      if (!entry.downloadUrl) warn('No updateUrl in the manifest, so the entry has no download link');
      return;
    }
    process.stdout.write(text);
  },
};

/** Lists the subcommand names, for error messages. */
export function pluginCommandNames() {
  return Object.keys(pluginCommands);
}
