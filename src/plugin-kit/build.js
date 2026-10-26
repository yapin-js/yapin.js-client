import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pack } from '../build/pack.js';
import { formatHeader } from './header.js';
import { apiVersion, version as frameworkVersion } from '../shared/constants.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * What `import … from 'yapin.js-client/runtime'` resolves to inside a *user* plugin. Deliberately tiny:
 * a user plugin is one file that people download, and bundling the whole runtime into it would ship a
 * second copy of code the client already has. Everything else a plugin needs is on `ctx` — `ctx.h`,
 * `ctx.ui`, `ctx.api`, `ctx.modules`, `ctx.patch` — so there is nothing to inline.
 *
 * Bundled plugins, built as part of a client app, still get the real module.
 */
export const RUNTIME_SHIM = `export const definePlugin = (definition) => definition;
export const defineTheme = (definition) => definition;
export const definePage = (definition) => definition;
export const defineBadgeProvider = (definition) => definition;
export const apiVersion = ${apiVersion};
export const version = ${JSON.stringify(frameworkVersion)};
`;

/** Named exports a user plugin may import from 'yapin.js-client/runtime'. */
export const SHIM_EXPORTS = ['definePlugin', 'defineTheme', 'definePage', 'defineBadgeProvider', 'apiVersion', 'version'];

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Bundles a plugin project into the single ES module people install: the generated metadata header,
 * then the packed code. Returns the text and where it was written.
 */
export function buildPlugin(manifest, { root, write = true } = {}) {
  const result = pack({
    entry: manifest.entry,
    root,
    format: 'function',
    virtual: { 'yapin.js-client/runtime': { code: RUNTIME_SHIM, dir: root } },
  });
  const text = `${formatHeader(manifest)}// Built by yapin-client plugin build. Edit the source, not this file.
const __bundle = ${result.code}();
export default __bundle.default;
`;
  const file = join(manifest.outDir, `${manifest.id}.plugin.js`);
  if (write) {
    mkdirSync(manifest.outDir, { recursive: true });
    writeFileSync(file, text);
  }
  return { file, text, bytes: Buffer.byteLength(text), sha256: sha256(text), files: result.files };
}

/**
 * The entry a registry index holds for this plugin: everything needed to list it and to check that a
 * download is the file that was reviewed. The hash lives here and not in the header, because a file
 * can't contain its own hash.
 */
export function indexEntry(manifest, build) {
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description ?? '',
    version: manifest.version,
    authors: manifest.authors,
    license: manifest.license ?? null,
    website: manifest.website ?? null,
    tags: manifest.tags,
    apiVersion: manifest.apiVersion,
    minClientVersion: manifest.minClientVersion ?? null,
    platforms: manifest.platforms,
    dependencies: manifest.dependencies,
    conflicts: manifest.conflicts,
    downloadUrl: manifest.updateUrl ?? null,
    sha256: build.sha256,
    bytes: build.bytes,
  };
}
