'use strict';

/**
 * Runs in the desktop app's main process, before Yapin’s own main.js. Loaded by the stub app.asar the
 * installer writes. It registers the preload that injects the client app into the page and answers
 * that preload's requests (storage, user plugin and theme files, API requests, secrets).
 *
 * It never loads Yapin’ itself: the stub does that afterwards, whether or not this succeeded, so a
 * broken client app can't stop Yapin’ from opening.
 */

const { app, ipcMain, session, shell, safeStorage, webContents } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PREFIX = 'yapin-client:';
const KINDS = new Set(['plugins', 'themes']);
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const KIND_FILE = { plugins: /\.(m?js)$/i, themes: /\.css$/i };
const NAMESPACE = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
const MAX_STORAGE_BYTES = 4_000_000;

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Writes through a temporary file and a rename, so a crash mid-write never leaves half a file. */
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function createLog(dir) {
  const file = path.join(dir, 'main.log');
  return (level, ...parts) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(file) && fs.statSync(file).size > 1_000_000) fs.renameSync(file, `${file}.1`);
      const text = parts.map((p) => (p instanceof Error ? p.stack : typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
      fs.appendFileSync(file, `${new Date().toISOString()} ${level} ${text}\n`);
    } catch {
      // logging is best effort
    }
    if (level === 'error') console.error('[yapin-client]', ...parts);
  };
}

module.exports = function setup({ payloadDir }) {
  const dataDir = path.dirname(payloadDir);
  const log = createLog(path.join(dataDir, 'logs'));
  const manifest = readJSON(path.join(payloadDir, 'manifest.json'), null);
  if (!manifest || !manifest.id) {
    log('error', `No usable manifest in ${payloadDir}; the client app is not loaded`);
    return false;
  }
  const config = manifest.config || {};
  const desktop = config.desktop || {};
  const origins = new Set(config.origins || []);
  const apiOrigins = new Set((config.api && config.api.allowedOrigins) || []);
  const dirs = {
    data: dataDir,
    plugins: path.join(dataDir, 'plugins'),
    themes: path.join(dataDir, 'themes'),
    storage: path.join(dataDir, 'storage'),
  };
  for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
  const statePath = path.join(dataDir, 'state.json');
  const state = readJSON(statePath, {});
  const saveState = () => {
    try {
      writeAtomic(statePath, JSON.stringify(state, null, 2));
    } catch (error) {
      log('error', 'could not save state', error);
    }
  };

  const runtimePath = path.join(payloadDir, 'runtime.js');
  let runtime;
  try {
    runtime = fs.readFileSync(runtimePath, 'utf8');
    const expected = manifest.files && manifest.files['runtime.js'];
    if (expected && sha256(runtime) !== expected) throw new Error('runtime.js does not match the manifest (damaged or edited install)');
  } catch (error) {
    log('error', error);
    return false;
  }

  const safeMode = process.argv.includes('--yc-safe-mode') || process.env.YAPIN_CLIENT_SAFE_MODE === '1' || state.safeModeNext === true || (state.crashes || 0) >= (desktop.crashLimit || 2);
  if (state.safeModeNext) {
    delete state.safeModeNext;
    saveState();
  }
  const nativeKey = `__yc_${crypto.randomBytes(9).toString('hex')}`;
  const environment = {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    os: `${os.type()} ${os.release()} (${process.arch})`,
    platform: process.platform,
  };
  log('info', `starting ${manifest.name} ${manifest.version}${safeMode ? ' in safe mode' : ''}`);

  /** Only the main frame of Yapin’s own pages may talk to us. */
  const trusted = (event) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame) return false;
    try {
      return origins.has(new URL(frame.url).origin);
    } catch {
      return false;
    }
  };
  const handle = (name, fn) =>
    ipcMain.handle(PREFIX + name, async (event, ...args) => {
      if (!trusted(event)) throw new Error('Not allowed');
      return fn(event, ...args);
    });
  const handleSync = (name, fn) =>
    ipcMain.on(PREFIX + name, (event, ...args) => {
      if (!trusted(event)) {
        event.returnValue = null;
        return;
      }
      try {
        event.returnValue = fn(event, ...args);
      } catch (error) {
        log('error', name, error);
        event.returnValue = null;
      }
    });

  const fileIn = (kind, name) => {
    if (!KINDS.has(kind)) throw new Error(`Unknown kind ${kind}`);
    if (typeof name !== 'string' || !FILE_NAME.test(name) || !KIND_FILE[kind].test(name)) throw new Error(`Invalid file name ${name}`);
    const full = path.resolve(dirs[kind], name);
    if (path.dirname(full) !== path.resolve(dirs[kind])) throw new Error('Invalid path');
    return full;
  };
  const listFiles = (kind) => {
    try {
      return fs
        .readdirSync(dirs[kind], { withFileTypes: true })
        .filter((e) => e.isFile() && FILE_NAME.test(e.name) && KIND_FILE[kind].test(e.name) && !e.name.startsWith('_'))
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  };
  const readAllUser = (kind) => {
    const allowed = (config[kind] && config[kind].user && config[kind].user.enabled) !== false;
    if (!allowed) return [];
    return listFiles(kind).map((file) => ({ file, source: fs.readFileSync(fileIn(kind, file), 'utf8') }));
  };
  const readStorage = () => {
    const out = {};
    for (const file of fs.readdirSync(dirs.storage)) {
      const ns = file.replace(/\.json$/, '');
      if (file.endsWith('.json') && NAMESPACE.test(ns)) out[ns] = readJSON(path.join(dirs.storage, file), null);
    }
    return out;
  };
  const writeStorage = (ns, json) => {
    if (!NAMESPACE.test(ns) || typeof json !== 'string' || json.length > MAX_STORAGE_BYTES) throw new Error('Invalid storage write');
    JSON.parse(json);
    writeAtomic(path.join(dirs.storage, `${ns}.json`), json);
    return true;
  };

  handleSync('boot', () => ({
    runtime,
    args: {
      manifest,
      nativeKey,
      safeMode,
      environment,
      snapshot: { storage: readStorage(), userPlugins: readAllUser('plugins'), userThemes: readAllUser('themes') },
    },
  }));
  handleSync('storage-write-sync', (_event, ns, json) => writeStorage(ns, json));
  handle('storage-write', (_event, ns, json) => writeStorage(ns, json));
  handle('list', (_event, kind) => (KINDS.has(kind) ? listFiles(kind) : []));
  handle('read', (_event, kind, name) => fs.readFileSync(fileIn(kind, name), 'utf8'));
  handle('write', (_event, kind, name, text) => {
    if (typeof text !== 'string' || text.length > 5_000_000) throw new Error('Invalid file');
    writeAtomic(fileIn(kind, name), text);
    return true;
  });
  handle('remove', (_event, kind, name) => {
    fs.rmSync(fileIn(kind, name), { force: true });
    return true;
  });
  handle('open-folder', (_event, kind) => {
    if (!dirs[kind] || kind === 'storage') throw new Error('Unknown folder');
    return shell.openPath(dirs[kind]);
  });
  handle('open-external', (_event, url) => {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'mailto:') throw new Error('Only https links open');
    return shell.openExternal(parsed.href);
  });
  handle('relaunch', (_event, options) => {
    if (options && options.safeMode) state.safeModeNext = true;
    state.crashes = 0;
    saveState();
    app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--yc-safe-mode') });
    app.quit();
    return true;
  });

  const secretsPath = path.join(dataDir, 'secrets.json');
  const secretName = (name) => {
    if (typeof name !== 'string' || !/^[\w.-]{1,64}$/.test(name)) throw new Error('Invalid secret name');
    return name;
  };
  handle('secret-get', (_event, name) => {
    const stored = readJSON(secretsPath, {})[secretName(name)];
    if (!stored || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  });
  handle('secret-set', (_event, name, value) => {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('This system has no secure storage for secrets');
    if (typeof value !== 'string' || value.length > 16_384) throw new Error('Invalid secret');
    const all = readJSON(secretsPath, {});
    all[secretName(name)] = safeStorage.encryptString(value).toString('base64');
    writeAtomic(secretsPath, JSON.stringify(all));
    return true;
  });
  handle('secret-delete', (_event, name) => {
    const all = readJSON(secretsPath, {});
    delete all[secretName(name)];
    writeAtomic(secretsPath, JSON.stringify(all));
    return true;
  });

  const userInstallAllowed = (kind) => {
    const user = (config[kind] && config[kind].user) || {};
    return user.enabled !== false && (user.install || {}).url !== false;
  };
  const installHostAllowed = (url) => {
    for (const kind of KINDS) {
      if (!userInstallAllowed(kind)) continue;
      const hosts = ((config[kind].user || {}).install || {}).allowedHosts || [];
      if (!hosts.length || hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))) return true;
    }
    return false;
  };
  const requestAllowed = (url, purpose) => {
    if (purpose === 'download') return url.protocol === 'https:' && installHostAllowed(url);
    if (url.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) return false;
    return apiOrigins.has(url.origin);
  };

  /** API requests from the page, sent from here so CORS doesn't apply, checked against the allowlist. */
  handle('request', async (_event, req) => {
    const timeout = Math.min(Number(req.timeout) || 15_000, 120_000);
    const maxBytes = Math.min(Number(req.maxBytes) || 5_000_000, 10_000_000);
    const purpose = req.purpose === 'download' ? 'download' : 'api';
    let url = new URL(String(req.url));
    const headers = {};
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (/^(cookie|host|origin|referer)$/i.test(key)) continue;
      headers[key] = String(value);
    }
    const method = String(req.method || 'GET').toUpperCase();
    for (let hop = 0; hop < 6; hop++) {
      if (!requestAllowed(url, purpose)) throw new Error(`${url.origin} isn't allowed`);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      let res;
      try {
        res = await fetch(url.href, { method, headers, body: req.body == null ? undefined : String(req.body), redirect: 'manual', signal: controller.signal });
      } catch (error) {
        clearTimeout(timer);
        throw new Error(error && error.name === 'AbortError' ? `timed out after ${timeout} ms` : String((error && error.message) || error));
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        clearTimeout(timer);
        url = new URL(res.headers.get('location'), url);
        continue;
      }
      const reader = res.body && res.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) {
            controller.abort();
            throw new Error('response too large');
          }
          chunks.push(Buffer.from(value));
        }
      } finally {
        clearTimeout(timer);
      }
      const out = {};
      res.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'set-cookie') out[key.toLowerCase()] = value;
      });
      return { status: res.status, headers: out, body: Buffer.concat(chunks).toString('utf8') };
    }
    throw new Error('too many redirects');
  });

  const broadcast = (channel, ...args) => {
    for (const contents of webContents.getAllWebContents()) {
      try {
        const url = new URL(contents.getURL());
        if (origins.has(url.origin)) contents.send(PREFIX + channel, ...args);
      } catch {
        // not a page of ours
      }
    }
  };
  const watchers = [];
  const watch = (dir, onChange) => {
    try {
      const timers = new Map();
      const watcher = fs.watch(dir, (_type, name) => {
        if (!name) return;
        clearTimeout(timers.get(name));
        timers.set(name, setTimeout(() => onChange(String(name)), 150));
      });
      watcher.unref?.();
      watchers.push(watcher);
    } catch (error) {
      log('warn', `can't watch ${dir}`, error);
    }
  };
  for (const kind of KINDS) {
    watch(dirs[kind], (name) => {
      if (!FILE_NAME.test(name) || !KIND_FILE[kind].test(name) || name.startsWith('_')) return;
      let text = null;
      try {
        text = fs.readFileSync(fileIn(kind, name), 'utf8');
      } catch {
        text = null;
      }
      broadcast('file-changed', kind, name, text);
    });
  }
  if (manifest.build && manifest.build.mode === 'development') {
    watch(payloadDir, (name) => {
      if (name !== 'runtime.js') return;
      log('info', 'runtime.js changed, reloading');
      for (const contents of webContents.getAllWebContents()) {
        try {
          if (origins.has(new URL(contents.getURL()).origin)) contents.reloadIgnoringCache();
        } catch {
          // ignore
        }
      }
    });
  }
  app.on('will-quit', () => watchers.forEach((w) => w.close()));

  const preloadPath = path.join(payloadDir, 'preload.cjs');
  const registerPreload = (ses) => {
    try {
      if (typeof ses.registerPreloadScript === 'function') ses.registerPreloadScript({ type: 'frame', id: `yapin-client-${manifest.id}`, filePath: preloadPath });
      else ses.setPreloads([...ses.getPreloads(), preloadPath]);
    } catch (error) {
      log('error', 'could not register the preload', error);
    }
  };
  // 'ready' listeners run before whenReady() callbacks, and this one is added before Yapin’s main.js
  // loads, so the preload is in place before Yapin’ creates its window either way.
  const onReady = () => {
    registerPreload(session.defaultSession);
    if (desktop.csp === 'relax') relaxCSP(session.defaultSession, origins);
  };
  if (app.isReady()) onReady();
  else app.once('ready', onReady);

  /** Crash-loop protection: two renderer crashes soon after loading mean the next start is in safe mode. */
  app.on('web-contents-created', (_event, contents) => {
    let loadedAt = 0;
    contents.on('did-finish-load', () => {
      loadedAt = Date.now();
      setTimeout(() => {
        if (!contents.isDestroyed() && state.crashes) {
          state.crashes = 0;
          saveState();
        }
      }, 60_000);
    });
    contents.on('render-process-gone', (_e, details) => {
      if (details.reason === 'clean-exit' || details.reason === 'killed') return;
      if (Date.now() - loadedAt < 60_000) {
        state.crashes = (state.crashes || 0) + 1;
        saveState();
        log('error', `renderer crashed (${details.reason}); crash count ${state.crashes}`);
      }
    });
    if (desktop.devtools === false) {
      contents.on('devtools-opened', () => contents.closeDevTools());
    }
  });
  return true;
};

/**
 * Only used with `desktop.csp: 'relax'`: if Yapin’ starts sending a Content-Security-Policy, adds
 * `blob:` to script-src so user plugins (imported from blob: URLs) still load. Nothing else changes.
 */
function relaxCSP(ses, origins) {
  ses.webRequest.onHeadersReceived((details, callback) => {
    let origin = '';
    try {
      origin = new URL(details.url).origin;
    } catch {
      // ignore
    }
    if (details.resourceType !== 'mainFrame' || !origins.has(origin)) return callback({});
    const headers = { ...details.responseHeaders };
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() !== 'content-security-policy') continue;
      headers[key] = headers[key].map((policy) =>
        policy
          .split(';')
          .map((part) => {
            const trimmed = part.trim();
            return /^script-src\s/i.test(trimmed) && !/\sblob:/.test(trimmed) ? `${trimmed} blob:` : trimmed;
          })
          .join('; '),
      );
    }
    callback({ responseHeaders: headers });
  });
}
