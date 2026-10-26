/**
 * Turns a manifest into the metadata header of a built plugin file. The header is what the client
 * reads before it runs anything, so everything a person needs to decide whether to install goes in
 * here — and nothing that the plugin shouldn't be able to claim about itself (see `@signature` in
 * src/runtime/meta.js).
 */

function author(a) {
  return a.url ? `${a.name} <${a.url}>` : a.name;
}

/** The header tags for a manifest, in a fixed order so rebuilds produce identical files. */
export function headerTags(manifest) {
  const tags = [
    ['id', manifest.id],
    ['name', manifest.name],
    ['description', manifest.description],
    ['version', manifest.version],
    ...manifest.authors.map((a) => ['author', author(a)]),
    ['license', manifest.license],
    ['website', manifest.website],
    ['apiVersion', manifest.apiVersion],
    ['minClientVersion', manifest.minClientVersion],
    manifest.platforms?.length ? ['platforms', manifest.platforms.join(', ')] : null,
    manifest.tags?.length ? ['tags', manifest.tags.join(', ')] : null,
    manifest.dependencies?.length ? ['dependencies', manifest.dependencies.join(', ')] : null,
    manifest.conflicts?.length ? ['conflicts', manifest.conflicts.join(', ')] : null,
    ['updateUrl', manifest.updateUrl],
  ];
  return tags.filter((tag) => tag && tag[1] !== undefined && tag[1] !== null && tag[1] !== '');
}

/** The `/** … *\/` block for a manifest, ending in a newline. */
export function formatHeader(manifest) {
  const lines = headerTags(manifest).map(([tag, value]) => ` * @${tag} ${String(value).replace(/\r?\n/g, ' ')}`);
  return `/**\n${lines.join('\n')}\n */\n`;
}

/**
 * Adds (or replaces) a `@signature` line in a built file's header. Kept here rather than in the signer
 * so the header stays the only thing that knows how headers are written.
 */
export function withSignature(text, { algorithm, keyId, value }) {
  const normalized = text.replace(/\r\n?/g, '\n');
  const header = /^\s*\/\*\*?[\s\S]*?\*\//.exec(normalized);
  if (!header) throw new Error('That file has no metadata header to sign');
  const line = ` * @signature ${algorithm} ${keyId} ${value}`;
  const stripped = header[0].replace(/^[^\S\n]*\*?[^\S\n]*@signature\b[^\n]*\n?/m, '');
  const block = stripped.replace(/[^\S\n]*\*\/\s*$/, `${line}\n */`);
  return normalized.slice(0, header.index) + block + normalized.slice(header.index + header[0].length);
}
