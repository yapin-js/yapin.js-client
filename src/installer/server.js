import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { renderPage } from './page.js';

/** Opens a URL in the default browser. Returns false if that couldn't be started. */
export function openBrowser(url, platform = process.platform) {
  try {
    const [command, args] =
      platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function sameToken(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readBody(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Body too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

/**
 * The installer's local web server. It listens on 127.0.0.1 only, on a random port, and every action
 * needs a random token the browser gets in the URL fragment (never sent over the network, removed from
 * the address bar once read). It also checks the Host and Origin headers, so other websites open in
 * the browser can't drive it. It stops when the page is closed or after `idle` ms without contact.
 */
export function startServer({ installer, operations, idle = 10 * 60_000, onLog = () => {} }) {
  const token = randomBytes(24).toString('base64url');
  let lastSeen = Date.now();
  let connected = false;
  let resolveDone;
  const done = new Promise((resolve) => {
    resolveDone = resolve;
  });

  const server = createServer(async (req, res) => {
    const { port } = server.address();
    const host = `127.0.0.1:${port}`;
    const send = (status, body, type = 'application/json', headers = {}) => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY', ...headers });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (req.headers.host !== host) return send(403, 'Wrong host', 'text/plain');
    const url = new URL(req.url, `http://${host}`);
    if (req.method === 'GET' && url.pathname === '/') {
      const nonce = randomBytes(16).toString('base64');
      const csp = `default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
      return send(200, renderPage(installer, { nonce }), 'text/html; charset=utf-8', { 'content-security-policy': csp });
    }
    if (!url.pathname.startsWith('/api/')) return send(404, 'Not found', 'text/plain');
    if (!sameToken(req.headers['x-installer-token'], token)) return send(403, 'Bad token', 'text/plain');
    if (req.method === 'POST' && req.headers.origin !== `http://${host}`) return send(403, 'Bad origin', 'text/plain');
    lastSeen = Date.now();
    connected = true;
    try {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const action = url.pathname.slice(5);
      const index = Number.isInteger(body.index) ? body.index : 0;
      switch (`${req.method} ${action}`) {
        case 'GET status':
          return send(200, await operations.status());
        case 'POST ping':
          return send(200, { ok: true });
        case 'POST install':
        case 'POST repair':
        case 'POST uninstall': {
          onLog(`${action}…`);
          const result = await operations[action]({ index, close: installer.closeApp !== 'never' && body.close === true, launch: body.launch === true, purge: body.purge === true });
          onLog(result.ok ? `${action}: done` : `${action}: ${result.error}`);
          return send(200, result);
        }
        case 'POST launch':
          return send(200, await operations.launch({ index }));
        case 'POST quit':
          send(200, { ok: true });
          setTimeout(stop, 100);
          return undefined;
        default:
          return send(404, 'Unknown action', 'text/plain');
      }
    } catch (error) {
      return send(500, { ok: false, error: error.message });
    }
  });

  const timer = setInterval(() => {
    const limit = connected ? 30_000 : idle;
    if (Date.now() - lastSeen > limit) stop();
  }, 2_000);

  function stop() {
    clearInterval(timer);
    server.close();
    server.closeAllConnections?.();
    resolveDone();
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/#t=${token}`, port, stop, done });
    });
  });
}
