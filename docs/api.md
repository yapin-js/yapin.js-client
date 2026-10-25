# API access

`client.api` talks to HTTP APIs: your backend, a badge server, anything your client app needs. Requests go only to origins you've allowed.

## Services

Name your APIs in the config:

```js
api: {
  services: {
    backend: { baseURL: 'https://api.nebula.example/v1', timeout: 10_000, retries: 2 },
    status: { baseURL: 'https://status.nebula.example', cache: '1m' },
  },
},
```

Then:

```js
const backend = client.api.service('backend');

const me = await backend.get('/me');
const page = await backend.get('/posts', { query: { page: 2, tags: ['a', 'b'] } });   // ?page=2&tags=a&tags=b
await backend.post('/reports', { json: { reason: 'spam' } });
await backend.delete(`/posts/${id}`);
```

Each service option can also be passed per request:

| Option | Default | |
| --- | --- | --- |
| `baseURL` | required | https (or http for localhost). |
| `headers` | | Sent with every request. From code, can be a function (also async). |
| `query` | | Added to every request. |
| `timeout` | `15000` | ms. |
| `retries` | 2 for GET, HEAD, PUT, DELETE, OPTIONS; 0 for others | Retried on network errors, 429, 502, 503 and 504, with backoff. `Retry-After` is respected up to 30 s. If you give a POST or PATCH retries, it's retried only on 429, since the server didn't act on it. |
| `cache` | none | `'30s'`, `'5m'`: reuse GET responses that long. |
| `auth` | none | `{ secret: 'name' }` sends `Authorization: Bearer <secret>`; `{ secret, type: 'header', header: 'x-api-key' }` sends the secret in that header; `scheme` replaces `Bearer`. |

Per request, there's also `json` (a body sent as JSON), `body` (a string), `headers`, and `responseType` (`json`, `text` or `auto`, which goes by the content type).

Identical GET requests in flight at the same time share one call.

## Results and errors

A request resolves with the parsed body. Anything other than a 2xx rejects with an `ApiError`:

```js
import { ApiError } from 'yapin.js-client/runtime';

try {
  await backend.get('/thing');
} catch (error) {
  if (error instanceof ApiError && error.status === 404) { /* … */ }
  error.body;   // the parsed body, if any; its "message" or "error" becomes the error message
}
```

## The allowlist

`client.api` reaches only:

- the origins of your `api.services`;
- the origins of your `badges.sources`;
- anything in `api.allowedOrigins`.

These are fixed when you build. On desktop the main process enforces the list too, and code in the page can't change it there, so even a malicious user plugin can't use your client app to send requests somewhere you didn't choose. Services added from code with `client.api.addService(name, config)` must also be on the list.

Without a service:

```js
await client.api.request({ url: 'https://api.nebula.example/v1/ping' });
client.api.isAllowed('https://elsewhere.example');   // false
```

## Desktop and web

On desktop, requests are sent by the main process, so CORS doesn't apply and your API doesn't need CORS headers. Cookies are never sent or stored. Responses are capped at 5 MB (configurable per request up to 10 MB), and redirects are followed only to allowed origins.

On the web, requests go straight from the page with `fetch` (`credentials: 'omit'`), so your API must send CORS headers for Yapin’s origins (`https://www.yapper.website` and `https://www.yapin.gg`).

Neither ever includes the person's Yapin’ session. The API client is for your services, not for automating Yapin’ accounts (which breaks Yapin’s terms).

## Secrets

Tokens and keys for your services:

```js
await client.secrets.set('backend-token', token);
await client.secrets.get('backend-token');
await client.secrets.delete('backend-token');
client.secrets.secure;   // true on desktop
```

On desktop, secrets are encrypted with the operating system's key store (Electron `safeStorage`: DPAPI on Windows, Keychain on macOS, libsecret on Linux) and kept in the main process; the page only ever sees the one it asks for. On the web there's no such thing: secrets are stored in `localStorage` and `secure` is false. Don't store anything there you couldn't afford to leak.

Pair secrets with `auth`, and the token is added to requests without your code handling it:

```js
api: { services: { backend: { baseURL: 'https://api.nebula.example', auth: { secret: 'backend-token' } } } },
```

## Downloading

`client.api.download(url, { maxBytes, allowedHosts })` fetches a text file from any https URL, outside the allowlist but size-limited. The framework uses it to install plugins and themes from links. It's limited by `plugins.user.install` and `themes.user.install`, and on desktop the main process only allows it when installing from links is enabled.
