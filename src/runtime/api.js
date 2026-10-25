import { ApiError, ClientError, ErrorCodes } from './errors.js';
import { parseDuration, safeURL } from './util.js';

const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);
const RETRY_STATUS = new Set([429, 502, 503, 504]);

function retryAfterMs(header) {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function buildURL(base, path = '', query) {
  const url = base ? new URL(String(path).replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`) : new URL(path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item instanceof Date ? item.toISOString() : String(item));
  }
  return url;
}

/**
 * Talks to HTTP APIs: your own backend, a badge server, anything the client app lists in
 * `api.services`. Only origins on the allowlist can be reached (on desktop the main process checks it
 * too, and the list there is fixed when the client app is built, so code in the page can't widen it).
 *
 *   const backend = client.api.service('backend');
 *   const me = await backend.get('/me');
 *   await backend.post('/reports', { json: { reason } });
 *
 * Requests never carry the user's Yapin’ session; cookies are left out and nothing reads Yapin’s
 * storage.
 */
export class ApiClient {
  #services = new Map();
  #cache = new Map();
  #inflight = new Map();
  #native;
  #fetch;
  #secrets;

  constructor({ services = {}, allowedOrigins = [], native = null, fetch, secrets, logger, maxResponseBytes = 5_000_000 } = {}) {
    this.#native = native;
    this.#fetch = fetch ?? ((...args) => globalThis.fetch(...args));
    this.#secrets = secrets ?? null;
    this.logger = logger;
    this.maxResponseBytes = maxResponseBytes;
    this.allowedOrigins = new Set(allowedOrigins.map((o) => new URL(o).origin));
    for (const [name, config] of Object.entries(services)) this.addService(name, config);
  }

  /** Whether `url` may be requested. */
  isAllowed(url) {
    const parsed = safeURL(String(url), { protocols: ['https:', 'http:'] });
    if (!parsed) return false;
    if (parsed.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(parsed.hostname)) return false;
    return this.allowedOrigins.has(parsed.origin);
  }

  addService(name, config) {
    if (!/^[A-Za-z][\w-]{0,63}$/.test(name)) throw new ClientError(ErrorCodes.InvalidDefinition, `Invalid service name "${name}"`);
    const base = safeURL(config?.baseURL, { protocols: ['https:', 'http:'] });
    if (!base) throw new ClientError(ErrorCodes.InvalidDefinition, `Service "${name}" needs an https baseURL`);
    if (!this.isAllowed(base.href)) {
      throw new ClientError(ErrorCodes.NotAllowed, `Service "${name}" (${base.origin}) isn't in api.allowedOrigins; add it to the client app's config`);
    }
    this.#services.set(name, { ...config, baseURL: base.href });
    return this.service(name);
  }

  removeService(name) {
    return this.#services.delete(name);
  }

  services() {
    return [...this.#services.keys()];
  }

  /** A small client bound to one service: get/post/put/patch/delete(path, options). */
  service(name) {
    if (!this.#services.has(name)) throw new ClientError(ErrorCodes.NotFound, `No API service "${name}"`);
    const call = (method) => (path, options = {}) => this.request({ ...options, service: name, path, method });
    return {
      name,
      request: (options) => this.request({ ...options, service: name }),
      get: call('GET'),
      post: call('POST'),
      put: call('PUT'),
      patch: call('PATCH'),
      delete: call('DELETE'),
    };
  }

  /**
   * One request. Options: url (or service + path), method, query, headers, json (a body sent as JSON),
   * body (string), timeout (ms), retries, cache ('5m': reuse a GET response that long), responseType
   * ('json', 'text' or 'auto').
   * Resolves with the parsed body; rejects with an ApiError carrying status and body.
   */
  async request(options) {
    const service = options.service ? this.#services.get(options.service) : null;
    if (options.service && !service) throw new ClientError(ErrorCodes.NotFound, `No API service "${options.service}"`);
    const method = String(options.method ?? 'GET').toUpperCase();
    const url = buildURL(service?.baseURL, options.url ?? options.path ?? '', { ...service?.query, ...options.query });
    if (!this.isAllowed(url.href)) throw new ApiError(`${url.origin} isn't an allowed API origin`, { url: url.href, method });
    const headers = { accept: 'application/json, text/plain;q=0.9, */*;q=0.5', ...(await this.#resolveHeaders(service)), ...options.headers };
    let body = options.body ?? null;
    if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers['content-type'] ??= 'application/json';
    }
    const timeout = options.timeout ?? service?.timeout ?? 15_000;
    const retries = options.retries ?? service?.retries ?? (IDEMPOTENT.has(method) ? 2 : 0);
    const cacheMs = method === 'GET' ? parseDuration(options.cache ?? service?.cache, 0) : 0;
    const key = `${method} ${url.href}`;
    if (cacheMs) {
      const hit = this.#cache.get(key);
      if (hit && hit.expires > Date.now()) return hit.value;
    }
    if (method === 'GET' && this.#inflight.has(key)) return this.#inflight.get(key);
    const run = this.#send({ url: url.href, method, headers, body, timeout, retries, responseType: options.responseType ?? 'auto' }).then((value) => {
      if (cacheMs) this.#cache.set(key, { value, expires: Date.now() + cacheMs });
      return value;
    });
    if (method === 'GET') {
      this.#inflight.set(key, run);
      run.then(
        () => this.#inflight.delete(key),
        () => this.#inflight.delete(key),
      );
    }
    return run;
  }

  /** Forgets cached responses (all of them, or those whose URL starts with `prefix`). */
  clearCache(prefix = '') {
    for (const key of [...this.#cache.keys()]) if (key.slice(key.indexOf(' ') + 1).startsWith(prefix)) this.#cache.delete(key);
  }

  /**
   * Downloads a text file from any https URL (for installing plugins and themes the user chose),
   * bypassing the API allowlist but limited in size. `allowedHosts` (if not empty) limits where from.
   */
  async download(url, { maxBytes = 1_000_000, allowedHosts = [], timeout = 20_000 } = {}) {
    const parsed = safeURL(String(url), { protocols: ['https:'] });
    if (!parsed) throw new ApiError('Only https:// links can be installed', { url });
    if (allowedHosts.length && !allowedHosts.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
      throw new ApiError(`Installing from ${parsed.hostname} isn't allowed (allowed: ${allowedHosts.join(', ')})`, { url });
    }
    const response = await this.#transport({ url: parsed.href, method: 'GET', headers: { accept: 'text/plain, text/css, application/javascript, */*' }, body: null, timeout, purpose: 'download', maxBytes });
    if (response.status < 200 || response.status >= 300) throw new ApiError(`Download failed with HTTP ${response.status}`, { url, status: response.status });
    if (response.body.length > maxBytes) throw new ApiError(`That file is over ${Math.round(maxBytes / 1000)} kB`, { url });
    return response.body;
  }

  async #resolveHeaders(service) {
    if (!service) return {};
    const headers = { ...(typeof service.headers === 'function' ? await service.headers() : service.headers) };
    const auth = service.auth;
    if (auth?.secret && this.#secrets) {
      const value = await this.#secrets.get(auth.secret);
      if (value) {
        if (auth.type === 'header') headers[auth.header ?? 'authorization'] = value;
        else headers.authorization = `${auth.scheme ?? 'Bearer'} ${value}`;
      }
    }
    return headers;
  }

  async #send(req) {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.#transport(req);
      } catch (error) {
        if (attempt < req.retries && IDEMPOTENT.has(req.method) && error?.code !== ErrorCodes.NotAllowed) {
          await sleep(backoff(attempt));
          continue;
        }
        throw error instanceof ApiError ? error : new ApiError(`${req.method} ${req.url} failed: ${error?.message ?? error}`, { url: req.url, method: req.method, cause: error });
      }
      if (RETRY_STATUS.has(response.status) && attempt < req.retries && (IDEMPOTENT.has(req.method) || response.status === 429)) {
        const wait = retryAfterMs(response.headers['retry-after']) ?? backoff(attempt);
        if (wait <= 30_000) {
          await sleep(wait);
          continue;
        }
      }
      const body = parseBody(response, req.responseType);
      if (response.status < 200 || response.status >= 300) {
        const message = (body && typeof body === 'object' && (body.message || body.error)) || `HTTP ${response.status}`;
        throw new ApiError(`${req.method} ${req.url}: ${message}`, { status: response.status, body, url: req.url, method: req.method });
      }
      return body;
    }
  }

  /** → { status, headers (lowercase keys), body (text) } */
  async #transport({ url, method, headers, body, timeout, purpose = 'api', maxBytes = this.maxResponseBytes }) {
    if (this.#native) return this.#native.request({ url, method, headers, body, timeout, purpose, maxBytes });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await this.#fetch(url, { method, headers, body, credentials: 'omit', redirect: 'follow', referrerPolicy: 'no-referrer', signal: controller.signal });
      const text = await res.text();
      if (text.length > maxBytes) throw new ApiError(`Response from ${new URL(url).origin} is too large`, { url, method });
      const out = {};
      res.headers.forEach((value, key) => {
        out[key.toLowerCase()] = value;
      });
      return { status: res.status, headers: out, body: text };
    } catch (error) {
      if (error?.name === 'AbortError') throw new ApiError(`${method} ${url} timed out after ${timeout} ms`, { url, method, cause: error });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseBody(response, type) {
  if (type === 'text') return response.body;
  const isJSON = /json/i.test(response.headers['content-type'] ?? '');
  if (type === 'json' || isJSON) {
    if (response.body === '') return null;
    try {
      return JSON.parse(response.body);
    } catch {
      if (type === 'json') throw new ApiError('The response is not valid JSON', { status: response.status, body: response.body });
      return response.body;
    }
  }
  return response.body;
}

function backoff(attempt) {
  return Math.min(10_000, 500 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Secrets for API services (tokens, keys). On desktop they're encrypted with the operating system's
 * key store (Electron safeStorage) and live outside the page. In a browser there is no such thing:
 * they're kept in localStorage and `secure` is false, so don't put anything there that would be bad
 * to leak.
 */
export class Secrets {
  #native;
  #store;

  constructor({ native = null, store = null } = {}) {
    this.#native = native;
    this.#store = store;
  }

  get secure() {
    return Boolean(this.#native);
  }

  async get(name) {
    if (this.#native) return (await this.#native.secretGet(name)) ?? null;
    return this.#store?.get(name, null) ?? null;
  }

  async set(name, value) {
    if (typeof value !== 'string') throw new TypeError('Secrets are strings');
    if (this.#native) return this.#native.secretSet(name, value);
    this.#store?.set(name, value);
    return true;
  }

  async delete(name) {
    if (this.#native) return this.#native.secretDelete(name);
    return this.#store?.delete(name) ?? false;
  }
}
