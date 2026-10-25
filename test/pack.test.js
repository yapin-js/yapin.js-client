import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack, PackError, tokenize } from '../src/build/pack.js';

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'yc-pack-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

function run(files, entry = 'a.js', options = {}) {
  const root = project(files);
  const out = pack({ entry, root, ...(typeof options === 'function' ? options(root) : options) });
  return (0, eval)(out.code)();
}

test('every import and export form', () => {
  const ns = run({
    'a.js': `
      import def, { b as bee, c } from './b.js';
      import * as all from './b.js';
      import './side.js';
      export const one = 1, two = { x: [1, 2] }
      export let counter = 0;
      export function inc() { counter++; }
      export async function* gen() {}
      export class K {}
      export default function () { return [def.name, bee, c(), all.b]; }
      export { bee as renamed };
      export * from './e.js';
      export * as eNs from './e.js';
      export { e as reE } from './e.js';
    `,
    'b.js': `export default class Thing {}\nexport const b = 'bee';\nexport function c() { return 'see'; }`,
    'e.js': `export const e = 'e'; export default 'not star-exported';`,
    'side.js': `globalThis.__packSide = true;`,
  });
  assert.deepEqual(ns.default(), ['Thing', 'bee', 'see', 'bee']);
  assert.equal(ns.one, 1);
  assert.deepEqual(ns.two, { x: [1, 2] });
  assert.equal(ns.renamed, 'bee');
  assert.equal(ns.e, 'e');
  assert.equal(ns.reE, 'e');
  assert.equal(ns.eNs.default, 'not star-exported');
  assert.equal(typeof ns.gen, 'function');
  assert.equal(typeof ns.K, 'function');
  assert.equal(globalThis.__packSide, true);
  ns.inc();
  ns.inc();
  assert.equal(ns.counter, 2, 'exports are live bindings');
});

test('strings, templates, regexes and comments that look like modules are left alone', () => {
  const ns = run({
    'a.js': `
      // import x from 'nope';
      /* export default 1 */
      const s = "import a from 'b'";
      const t = \`export \${'default'} \${\`nested \${1 + 2} }\`}\`;
      const r = /import x from 'y'/g;
      const division = 10 / 2 / 1;
      const obj = { import: 1, export: 2 };
      export default [s, t, r.source, division, obj.import + obj.export];
    `,
  });
  assert.deepEqual(ns.default, ["import a from 'b'", 'export default nested 3 }', "import x from 'y'", 5, 3]);
});

test('anonymous default classes and expressions', () => {
  assert.equal(run({ 'a.js': 'export default class extends Array {}' }).default.prototype instanceof Array, true);
  assert.equal(run({ 'a.js': 'export default 6 * 7;' }).default, 42);
  assert.equal(run({ 'a.js': 'export default async function () { return 1; }' }).default.constructor.name, 'AsyncFunction');
});

test('json, css and text imports', () => {
  const ns = run({ 'a.js': `import d from './d.json'; import css from './s.css'; export default [d.k, css.trim()];`, 'd.json': '{"k": 42}', 's.css': ' .x{} ' });
  assert.deepEqual(ns.default, [42, '.x{}']);
});

test('import.meta.url becomes a stable bundle URL', () => {
  const ns = run({ 'a.js': 'export const url = (() => import.meta.url)();' }, 'a.js', { urlPrefix: 'yapin-client://t/' });
  assert.equal(ns.url, 'yapin-client://t/a.js');
});

test('module format keeps node: imports as real imports', () => {
  const root = project({ 'a.js': `import { join } from 'node:path';\nimport fs from 'fs';\nexport const j = join('a', 'b'); export const has = typeof fs.readFileSync;` });
  const out = pack({ entry: 'a.js', root, format: 'module' });
  assert.match(out.code, /^import \* as __ext0 from "node:path";/m);
  assert.match(out.code, /import \* as __ext1 from "node:fs";/);
});

test('node built-ins are refused for the page', () => {
  assert.throws(() => run({ 'a.js': `import fs from 'node:fs';` }), (e) => e instanceof PackError && /Node built-in/.test(e.message));
});

test('circular imports fail with the cycle in the message', () => {
  assert.throws(() => run({ 'a.js': `import './b.js';`, 'b.js': `import './a.js';` }), /Circular import: a\.js → b\.js → a\.js/);
});

test('missing files and bad syntax are reported with the file', () => {
  assert.throws(() => run({ 'a.js': `import x from './nope.js';` }), /Can't find "\.\/nope\.js" \(a\.js\)/);
  assert.throws(() => run({ 'a.js': `const s = 'unterminated;` }), /Unterminated string \(a\.js:1:/);
  assert.throws(() => run({ 'a.js': `export const { a } = {};` }), /Destructuring/);
  assert.throws(() => run({ 'a.js': `export default function () {` }), /compile/);
});

test('aliases and packages in node_modules', () => {
  const ns = run({
    'a.js': `import { x } from 'lib'; import { y } from 'alias-me'; export default x + y;`,
    'node_modules/lib/package.json': JSON.stringify({ name: 'lib', exports: { '.': { import: './esm.js', require: './cjs.js' } } }),
    'node_modules/lib/esm.js': 'export const x = 1;',
    'other.js': 'export const y = 2;',
  }, 'a.js', (root) => ({ alias: { 'alias-me': join(root, 'other.js') } }));
  assert.equal(ns.default, 3);
});

test('tokenizer tracks bracket depth', () => {
  const tokens = tokenize('a({ b: [c] })');
  assert.deepEqual(tokens.map((t) => [t.value, t.depth]), [['a', 0], ['(', 0], ['{', 1], ['b', 2], [':', 2], ['[', 2], ['c', 3], [']', 2], ['}', 1], [')', 0]]);
});
