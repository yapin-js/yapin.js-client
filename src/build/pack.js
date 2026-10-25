import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';

/**
 * A small ES module bundler, so the framework needs no dependencies. It understands every form of
 * `import` and `export` and everything around them (strings, templates, regexes, comments), wraps each
 * file in a function, and wires them together with live export bindings. What it doesn't do:
 * circular imports, top-level await, and CommonJS packages. Each of those fails the build with a
 * message saying where.
 */

export class PackError extends Error {
  constructor(message, { file, index, source } = {}) {
    const where = file ? ` (${file}${source != null && index != null ? `:${lineCol(source, index)}` : ''})` : '';
    super(message + where);
    this.name = 'PackError';
    this.file = file;
  }
}

function lineCol(source, index) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return `${line}:${index - last}`;
}

const KEYWORDS_BEFORE_EXPRESSION = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await',
]);
const ID_START = /[A-Za-z_$\u0080-\uffff\\]/;
const ID_PART = /[\w$\u0080-\uffff\\]/;
const LINE_BREAK = /[\n\r\u2028\u2029]/;

function regexAllowed(prev) {
  if (!prev) return true;
  if (prev.type === 'ident') return KEYWORDS_BEFORE_EXPRESSION.has(prev.value);
  if (prev.type === 'punct') return prev.value !== ')' && prev.value !== ']';
  return false;
}

function skipString(src, i, file) {
  const quote = src[i];
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === quote) return i + 1;
    else if (c === '\n') break;
  }
  throw new PackError('Unterminated string', { file, index: i, source: src });
}

function skipRegex(src, i) {
  let inClass = false;
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (LINE_BREAK.test(c)) return -1;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      i++;
      while (i < src.length && ID_PART.test(src[i])) i++;
      return i;
    }
  }
  return -1;
}

function skipTemplate(src, i, file) {
  for (i++; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') i++;
    else if (c === '`') return i + 1;
    else if (c === '$' && src[i + 1] === '{') i = scan(src, i + 2, file, true).end - 1;
  }
  throw new PackError('Unterminated template literal', { file, index: i, source: src });
}

/**
 * Splits source into tokens with their bracket depth. With `untilClose`, stops after the `}` that closes
 * a template `${…}` and returns where that was.
 */
function scan(src, start, file, untilClose = false) {
  const tokens = [];
  let depth = 0;
  let nl = false;
  let i = start;
  const push = (type, from, to) => {
    tokens.push({ type, value: src.slice(from, to), start: from, end: to, depth, nl });
    nl = false;
  };
  while (i < src.length) {
    const c = src[i];
    if (LINE_BREAK.test(c)) {
      nl = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\f' || c === '\v' || c === '\ufeff' || c === '\u00a0' || /\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && !LINE_BREAK.test(src[i])) i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) throw new PackError('Unterminated comment', { file, index: i, source: src });
      if (LINE_BREAK.test(src.slice(i, end))) nl = true;
      i = end + 2;
      continue;
    }
    if (c === '#' && i === 0 && src[1] === '!') {
      while (i < src.length && !LINE_BREAK.test(src[i])) i++;
      continue;
    }
    const from = i;
    if (c === '"' || c === "'") {
      i = skipString(src, i, file);
      push('string', from, i);
    } else if (c === '`') {
      i = skipTemplate(src, i, file);
      push('template', from, i);
    } else if (ID_START.test(c)) {
      i++;
      while (i < src.length && ID_PART.test(src[i])) i++;
      push('ident', from, i);
    } else if (c === '#') {
      i++;
      while (i < src.length && ID_PART.test(src[i])) i++;
      push('private', from, i);
    } else if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      i++;
      while (i < src.length && /[\w.]/.test(src[i])) {
        if ((src[i] === 'e' || src[i] === 'E') && (src[i + 1] === '+' || src[i + 1] === '-') && !/^0[xX]/.test(src.slice(from, i))) i++;
        i++;
      }
      push('number', from, i);
    } else if (c === '/' && regexAllowed(tokens[tokens.length - 1])) {
      const end = skipRegex(src, i);
      if (end < 0) {
        i++;
        push('punct', from, i);
      } else {
        i = end;
        push('regex', from, i);
      }
    } else if (c === '(' || c === '[' || c === '{') {
      i++;
      push('punct', from, i);
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      if (untilClose && c === '}' && depth === 0) return { tokens, end: i + 1 };
      depth--;
      if (depth < 0) throw new PackError(`Unexpected "${c}"`, { file, index: i, source: src });
      i++;
      push('punct', from, i);
    } else {
      i++;
      push('punct', from, i);
    }
  }
  if (untilClose) throw new PackError('Unterminated template expression', { file, index: start, source: src });
  return { tokens, end: i };
}

export function tokenize(source, file) {
  return scan(source, 0, file).tokens;
}

function unquote(token) {
  return JSON.parse(token.value[0] === "'" ? `"${token.value.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"')}"` : token.value);
}

const CONTINUES = new Set([',', '.', '=', '+', '-', '*', '/', '%', '&', '|', '^', '?', ':', '<', '>', '!', '~', '(', '[']);

/** Finds the module syntax in one file. */
function parseModule(source, file) {
  const tokens = tokenize(source, file);
  const imports = [];
  const exports = [];
  const edits = [];
  const fail = (message, token) => {
    throw new PackError(message, { file, index: token?.start ?? source.length, source });
  };
  let k = 0;
  const at = (n) => tokens[n];
  const expect = (n, type, value) => {
    const t = at(n);
    if (!t || t.type !== type || (value !== undefined && t.value !== value)) fail(`Expected ${value ?? type}`, t);
    return t;
  };
  /** Skips `with { … }` / `assert { … }` and a `;`, returning the index after the statement. */
  const finish = (n) => {
    if (at(n)?.type === 'ident' && (at(n).value === 'with' || at(n).value === 'assert') && at(n + 1)?.value === '{' && !at(n).nl) {
      n += 2;
      while (at(n) && !(at(n).value === '}' && at(n).depth === 0)) n++;
      n++;
    }
    if (at(n)?.type === 'punct' && at(n).value === ';') n++;
    return n;
  };
  const endOf = (n) => (at(n - 1) ? at(n - 1).end : source.length);
  const specifierName = (t) => (t.type === 'string' ? unquote(t) : t.type === 'ident' ? t.value : fail('Expected a name', t));
  const parseSpecifiers = (n) => {
    const list = [];
    n++;
    while (at(n) && at(n).value !== '}') {
      const name = specifierName(at(n));
      n++;
      let alias = name;
      if (at(n)?.type === 'ident' && at(n).value === 'as') {
        alias = specifierName(at(n + 1));
        n += 2;
      }
      list.push([name, alias]);
      if (at(n)?.value === ',') n++;
    }
    expect(n, 'punct', '}');
    return { list, next: n + 1 };
  };

  while (k < tokens.length) {
    const t = tokens[k];
    const prev = tokens[k - 1];
    const notProperty = !(prev && prev.type === 'punct' && prev.value === '.');
    if (t.type === 'ident' && t.value === 'import' && notProperty && at(k + 1)?.value === '.') {
      expect(k + 2, 'ident', 'meta');
      edits.push({ start: t.start, end: at(k + 2).end, text: '__meta', meta: true });
      k += 3;
      continue;
    }
    const isKeyword = t.type === 'ident' && t.depth === 0 && notProperty;
    if (isKeyword && t.value === 'import') {
      if (at(k + 1)?.value === '(') {
        k++;
        continue;
      }
      const decl = { start: t.start, defaultName: null, namespace: null, named: [] };
      let n = k + 1;
      if (at(n)?.type === 'string') {
        decl.source = unquote(at(n));
        n = finish(n + 1);
      } else {
        if (at(n)?.type === 'ident' && at(n).value !== 'from') {
          decl.defaultName = at(n).value;
          n++;
          if (at(n)?.value === ',') n++;
        }
        if (at(n)?.value === '*') {
          expect(n + 1, 'ident', 'as');
          decl.namespace = expect(n + 2, 'ident').value;
          n += 3;
        } else if (at(n)?.value === '{') {
          const parsed = parseSpecifiers(n);
          decl.named = parsed.list;
          n = parsed.next;
        }
        expect(n, 'ident', 'from');
        decl.source = unquote(expect(n + 1, 'string'));
        n = finish(n + 2);
      }
      decl.end = endOf(n);
      imports.push(decl);
      edits.push({ start: decl.start, end: decl.end, text: '' });
      k = n;
      continue;
    }
    if (isKeyword && t.value === 'export') {
      let n = k + 1;
      const next = at(n);
      if (!next) fail('Unexpected end after export', t);
      if (next.type === 'ident' && next.value === 'default') {
        n++;
        const head = at(n);
        const isAsyncFn = head?.value === 'async' && at(n + 1)?.value === 'function' && !at(n + 1).nl;
        if (head && (head.value === 'function' || isAsyncFn)) {
          let f = isAsyncFn ? n + 1 : n;
          if (at(f + 1)?.value === '*') f++;
          if (at(f + 1)?.type === 'ident') {
            exports.push(['default', at(f + 1).value]);
            edits.push({ start: t.start, end: head.start, text: '' });
          } else {
            exports.push(['default', '__default']);
            edits.push({ start: t.start, end: head.start, text: '' }, { start: at(f).end, end: at(f).end, text: ' __default' });
          }
        } else if (head && head.value === 'class') {
          if (at(n + 1)?.type === 'ident' && at(n + 1).value !== 'extends') {
            exports.push(['default', at(n + 1).value]);
            edits.push({ start: t.start, end: head.start, text: '' });
          } else {
            exports.push(['default', '__default']);
            edits.push({ start: t.start, end: head.start, text: '' }, { start: head.end, end: head.end, text: ' __default' });
          }
        } else {
          exports.push(['default', '__default']);
          edits.push({ start: t.start, end: next.end, text: 'const __default =' });
        }
        k = n;
        continue;
      }
      if (next.type === 'ident' && (next.value === 'function' || next.value === 'class' || (next.value === 'async' && at(n + 1)?.value === 'function'))) {
        let f = next.value === 'async' ? n + 1 : n;
        if (at(f + 1)?.value === '*') f++;
        const name = expect(f + 1, 'ident').value;
        exports.push([name, name]);
        edits.push({ start: t.start, end: next.start, text: '' });
        k = f + 2;
        continue;
      }
      if (next.type === 'ident' && (next.value === 'const' || next.value === 'let' || next.value === 'var')) {
        n++;
        if (at(n)?.type !== 'ident') fail('Destructuring in an export declaration is not supported; declare the names, then export them', at(n));
        exports.push([at(n).value, at(n).value]);
        for (n++; n < tokens.length; n++) {
          const tok = at(n);
          if (tok.depth !== 0) continue;
          if (tok.value === ';') break;
          if (tok.nl && !CONTINUES.has(tok.value) && !CONTINUES.has(at(n - 1).value)) break;
          if (tok.value === ',' && at(n + 1)?.type === 'ident') exports.push([at(n + 1).value, at(n + 1).value]);
        }
        edits.push({ start: t.start, end: next.start, text: '' });
        k = n;
        continue;
      }
      if (next.value === '{') {
        const parsed = parseSpecifiers(n);
        n = parsed.next;
        if (at(n)?.type === 'ident' && at(n).value === 'from') {
          const from = unquote(expect(n + 1, 'string'));
          n = finish(n + 2);
          imports.push({ source: from, reexport: parsed.list });
        } else {
          n = finish(n);
          for (const [local, exported] of parsed.list) exports.push([exported, local]);
        }
        edits.push({ start: t.start, end: endOf(n), text: '' });
        k = n;
        continue;
      }
      if (next.value === '*') {
        n++;
        let as = null;
        if (at(n)?.type === 'ident' && at(n).value === 'as') {
          as = specifierName(at(n + 1));
          n += 2;
        }
        expect(n, 'ident', 'from');
        const from = unquote(expect(n + 1, 'string'));
        n = finish(n + 2);
        imports.push(as ? { source: from, reexportNamespace: as } : { source: from, reexportAll: true });
        edits.push({ start: t.start, end: endOf(n), text: '' });
        k = n;
        continue;
      }
      fail(`Unsupported export form "export ${next.value}"`, next);
    }
    k++;
  }
  return { imports, exports, edits };
}

function applyEdits(source, edits) {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let out = '';
  let last = 0;
  for (const edit of sorted) {
    out += source.slice(last, edit.start) + edit.text;
    last = edit.end;
  }
  return out + source.slice(last);
}

const TEXT_EXTENSIONS = new Set(['.css', '.txt', '.html', '.svg', '.md']);
const JS_EXTENSIONS = new Set(['.js', '.mjs']);

function isFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function tryFile(base) {
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, join(base, 'index.js'), join(base, 'index.mjs')]) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function pickExport(target, conditions) {
  if (typeof target === 'string') return target;
  if (Array.isArray(target)) {
    for (const item of target) {
      const found = pickExport(item, conditions);
      if (found) return found;
    }
    return null;
  }
  if (target && typeof target === 'object') {
    for (const [key, value] of Object.entries(target)) {
      if (key === 'default' || conditions.includes(key)) {
        const found = pickExport(value, conditions);
        if (found) return found;
      }
    }
  }
  return null;
}

function resolvePackage(spec, fromDir, conditions) {
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const subpath = `.${spec.slice(name.length)}`;
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const pkgDir = join(dir, 'node_modules', name);
    const pkgFile = join(pkgDir, 'package.json');
    if (existsSync(pkgFile)) {
      const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
      if (pkg.exports) {
        const map = typeof pkg.exports === 'string' || Array.isArray(pkg.exports) || !Object.keys(pkg.exports).some((key) => key.startsWith('.')) ? { '.': pkg.exports } : pkg.exports;
        const target = map[subpath];
        const picked = target === undefined ? null : pickExport(target, conditions);
        return picked ? tryFile(join(pkgDir, picked)) : null;
      }
      return tryFile(join(pkgDir, subpath === '.' ? pkg.module ?? pkg.main ?? 'index.js' : subpath));
    }
    if (dirname(dir) === dir) return null;
  }
}

const BUILTINS = new Set(builtinModules);

/**
 * Bundles `entry` and everything it imports into one script.
 *
 * @param {object} options
 * @param {string} options.entry          A file path, or the id of a `virtual` module.
 * @param {'function' | 'module'} [options.format]
 *   'function': an expression `(function () { … return entryExports; })`, for the page and userscripts.
 *   'module': an ES module for Node, with `node:` imports kept as real imports.
 * @param {Record<string, string>} [options.alias]   Specifier → file path.
 * @param {Record<string, { code: string, dir: string }>} [options.virtual]   Modules that only exist in memory.
 * @param {string[]} [options.conditions]  package.json export conditions to prefer.
 * @param {string} [options.root]          Paths in comments and import.meta.url are relative to this.
 * @param {string} [options.urlPrefix]     import.meta.url becomes urlPrefix + relative path ('function' format).
 * @param {boolean} [options.check]        Compile the result once to catch syntax errors early (default true).
 */
export function pack(options) {
  const { entry, format = 'function', alias = {}, virtual = {}, conditions = format === 'module' ? ['node', 'import'] : ['browser', 'import', 'module'], urlPrefix = 'yapin-client://bundle/', check = true } = options;
  const root = options.root ?? process.cwd();
  const ids = new Map();
  const modules = [];
  const externals = new Map();
  const display = (file) => (virtual[file] ? file : relative(root, file).split(sep).join('/'));

  const resolveSpec = (spec, fromFile) => {
    if (Object.hasOwn(alias, spec)) return { file: alias[spec] };
    if (Object.hasOwn(virtual, spec)) return { file: spec };
    if (spec.startsWith('node:') || BUILTINS.has(spec)) {
      if (format !== 'module') throw new PackError(`"${spec}" is a Node built-in and can't run in the page`, { file: display(fromFile) });
      return { external: spec.startsWith('node:') ? spec : `node:${spec}` };
    }
    const fromDir = virtual[fromFile] ? virtual[fromFile].dir : dirname(fromFile);
    let file;
    if (spec.startsWith('./') || spec.startsWith('../') || isAbsolute(spec)) file = tryFile(resolve(fromDir, spec));
    else if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) throw new PackError(`Can't bundle "${spec}"; URL imports are only allowed as dynamic import()`, { file: display(fromFile) });
    else file = resolvePackage(spec, fromDir, conditions);
    if (!file) throw new PackError(`Can't find "${spec}"`, { file: display(fromFile) });
    return { file };
  };

  const visit = (file, stack) => {
    if (ids.has(file)) {
      if (stack.includes(file)) {
        const cycle = [...stack.slice(stack.indexOf(file)), file].map(display).join(' → ');
        throw new PackError(`Circular import: ${cycle}. Move the shared code into its own file`);
      }
      return ids.get(file);
    }
    const id = ids.size;
    ids.set(file, id);
    const record = { id, file, name: display(file) };
    modules.push(record);
    const ext = virtual[file] ? '.js' : extname(file).toLowerCase();
    const source = virtual[file] ? virtual[file].code : readFileSync(file, 'utf8');
    if (ext === '.json') {
      record.body = '';
      record.exportsCode = `__export(__exports, { default: () => __json });\nconst __json = ${JSON.stringify(JSON.parse(source))};`;
      record.importCode = '';
      return id;
    }
    if (TEXT_EXTENSIONS.has(ext)) {
      record.body = '';
      record.exportsCode = `__export(__exports, { default: () => __text });\nconst __text = ${JSON.stringify(source)};`;
      record.importCode = '';
      return id;
    }
    if (!JS_EXTENSIONS.has(ext)) throw new PackError(`Don't know how to bundle ${ext} files`, { file: record.name });
    const parsed = parseModule(source, record.name);
    const lines = [];
    const exportLines = [];
    const getters = [...parsed.exports];
    let n = 0;
    for (const decl of parsed.imports) {
      const target = resolveSpec(decl.source, file);
      let ref;
      if (target.external) {
        if (!externals.has(target.external)) externals.set(target.external, `__ext${externals.size}`);
        ref = externals.get(target.external);
      } else {
        const depId = visit(target.file, [...stack, file]);
        ref = `__require(${depId})`;
      }
      if (decl.reexport || decl.reexportAll || decl.reexportNamespace) {
        const local = `__re${n++}`;
        lines.push(`const ${local} = ${ref};`);
        if (decl.reexportAll) exportLines.push(`__star(__exports, ${local});`);
        else if (decl.reexportNamespace) getters.push([decl.reexportNamespace, local]);
        else for (const [name, exported] of decl.reexport) getters.push([exported, `${local}[${JSON.stringify(name)}]`]);
        continue;
      }
      if (decl.namespace) lines.push(`const ${decl.namespace} = ${ref};`);
      const named = decl.named.map(([name, local]) => (name === local && /^[A-Za-z_$][\w$]*$/.test(name) ? name : `${JSON.stringify(name)}: ${local}`));
      if (decl.defaultName) named.unshift(`default: ${decl.defaultName}`);
      if (named.length) lines.push(`const { ${named.join(', ')} } = ${ref};`);
      else if (!decl.namespace) lines.push(`${ref};`);
    }
    const edits = parsed.edits.map((edit) => (edit.meta && format === 'module' ? { ...edit, text: 'import.meta' } : edit));
    if (getters.length) {
      exportLines.unshift(`__export(__exports, { ${getters.map(([name, local]) => `${JSON.stringify(name)}: () => ${local}`).join(', ')} });`);
    }
    record.importCode = lines.join('\n');
    record.exportsCode = exportLines.join('\n');
    record.body = applyEdits(source, edits).replace(/^#!.*/, '');
    return id;
  };

  const entryFile = Object.hasOwn(virtual, entry) ? entry : resolve(root, entry);
  if (!virtual[entryFile] && !isFile(entryFile)) throw new PackError(`Entry not found: ${entry}`);
  visit(entryFile, []);

  const defs = modules
    .map((m) => {
      const url = JSON.stringify(urlPrefix + m.name);
      return [
        `// ${m.name}`,
        `__defs[${m.id}] = function (__exports, __require, __export, __star, __meta) {`,
        `"use strict";`,
        m.importCode,
        m.exportsCode,
        m.body,
        `};`,
        `__urls[${m.id}] = ${url};`,
      ]
        .filter((line) => line !== '')
        .join('\n');
    })
    .join('\n\n');

  const runtime = [
    'const __defs = [], __urls = [], __cache = [];',
    'const __export = (target, getters) => { for (const key of Object.keys(getters)) Object.defineProperty(target, key, { get: getters[key], enumerable: true }); };',
    'const __star = (target, source) => { for (const key of Object.keys(source)) if (key !== "default" && !Object.prototype.hasOwnProperty.call(target, key)) Object.defineProperty(target, key, { get: () => source[key], enumerable: true }); };',
    'const __require = (id) => {',
    '  if (__cache[id]) return __cache[id];',
    '  const exports = Object.create(null);',
    '  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    '  __cache[id] = exports;',
    '  __defs[id].call(undefined, exports, __require, __export, __star, Object.freeze({ url: __urls[id] }));',
    '  return exports;',
    '};',
  ].join('\n');

  let code;
  if (format === 'module') {
    const head = [...externals].map(([spec, local]) => `import * as ${local} from ${JSON.stringify(spec)};`).join('\n');
    code = `${head}\n${runtime}\n\n${defs}\n\n__require(0);\n`;
  } else if (format === 'function') {
    code = `(function () {\n${runtime}\n\n${defs}\n\nreturn __require(0);\n})`;
  } else {
    throw new TypeError(`Unknown format "${format}"`);
  }

  if (check) {
    const body = format === 'module' ? code.replace(/^import \* as .*$/gm, '').replace(/\bimport\.meta\b/g, '({})') : code;
    try {
      new Script(body, { filename: 'bundle.js' });
    } catch (error) {
      const near = error.stack?.split('\n').slice(1, 3).join(' ') ?? '';
      throw new PackError(`The bundle doesn't compile: ${error.message} ${near}`.trim());
    }
  }

  return {
    code,
    files: modules.map((m) => m.file),
    hash: createHash('sha256').update(code).digest('hex'),
  };
}
