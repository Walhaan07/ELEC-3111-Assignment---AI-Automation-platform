/**
 * The one function every Google node calls.
 *
 * Token refresh, retries, rate limits and scope errors live in here once, so
 * sheets.js, docs.js, drive.js and gmail.js are twenty lines each.
 *
 * It does NOT import the database. The API hands it a way to fetch and store
 * credentials at boot (`useCredentialStore`), which keeps `packages/` free of
 * any dependency on `apps/` - so the node package can be tested with a fake
 * store and no Postgres at all.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Base addresses, in one place so a test can point them at a local fake server. */
export const googleApi = {
  get sheets() { return process.env.GOOGLE_API_BASE ?? 'https://sheets.googleapis.com'; },
  get docs() { return process.env.GOOGLE_API_BASE ?? 'https://docs.googleapis.com'; },
  get drive() { return process.env.GOOGLE_API_BASE ?? 'https://www.googleapis.com'; },
  get gmail() { return process.env.GOOGLE_API_BASE ?? 'https://gmail.googleapis.com'; },
  get oauth() { return process.env.GOOGLE_API_BASE ?? 'https://oauth2.googleapis.com'; },
};

const cache = new Map();      // credentialId -> { token, expiresAt }
const inFlight = new Map();   // credentialId -> Promise, so eight items refresh ONCE

/**
 * The store the API installs at boot.
 *   load(credentialId)   -> { access_token, refresh_token, expires_in, ... }
 *   save(credentialId, tokens, expiresAt)
 */
let store = {
  async load() {
    throw new Error('No credential store is connected - the API installs one at boot');
  },
  async save() {},
};

export function useCredentialStore(next) {
  store = next;
  cache.clear();
  inFlight.clear();
}

/** Tests and a credential being reconnected both need the cached token gone. */
export function forgetCredential(credentialId) {
  if (credentialId === undefined) { cache.clear(); inFlight.clear(); return; }
  cache.delete(credentialId);
  inFlight.delete(credentialId);
}

export async function googleRequest(credentialId, url, options = {}) {
  // catch the empty sidebar field here, with a clear message - not four calls deep,
  // reported as "credential has been deleted" for something that was never set
  if (!credentialId) throw new Error('This node has no credential selected - pick one in the sidebar');

  const { retries = 4, timeoutMs = 30_000, ...init } = options;
  let token = await getAccessToken(credentialId);

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', ...init.headers, Authorization: `Bearer ${token}` },
    });

    if (res.ok) return res.status === 204 ? {} : res.json();

    // 401 - the hour is up. Refresh once and try the same request again.
    if (res.status === 401 && attempt === 0) {
      token = await refresh(credentialId);
      continue;
    }

    const body = await res.text();

    // 403 "insufficient permissions" is a SCOPE problem, and no amount of retrying
    // fixes it. Say the real cause instead of "Google 403".
    if (res.status === 403 && /insufficient|scope/i.test(body)) {
      throw new Error('This credential was not granted the scope this node needs. '
                    + 'Reconnect it and tick the missing permission.');
    }

    // 429 / 5xx - back off and try again, honouring Retry-After when Google sends it
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const after = Number(res.headers.get('retry-after')) * 1000;
      await sleep(after || Math.min(16_000, 2 ** attempt * 1000) + Math.random() * 400);
      continue;
    }

    throw new Error(`Google ${res.status}: ${body.slice(0, 300)}`);
  }
  throw new Error('Google kept refusing after every retry');
}

async function getAccessToken(credentialId) {
  const hit = cache.get(credentialId);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;   // 60 s safety margin
  return refresh(credentialId);
}

function refresh(credentialId) {
  // single-flight: if a refresh is already running, everybody waits for that one.
  // Without this, ten items whose token expired at the same millisecond send ten
  // refresh requests, nine of which invalidate each other.
  if (inFlight.has(credentialId)) return inFlight.get(credentialId);

  const pending = (async () => {
    const saved = await store.load(credentialId);
    if (!saved) throw new Error('That credential has been deleted');
    if (!saved.refresh_token) throw new Error('This credential has no refresh token - reconnect it');

    const res = await fetch(`${googleApi.oauth}/token`, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: saved.refresh_token,
        grant_type: 'refresh_token',
        client_id: process.env.GOOGLE_CLIENT_ID ?? '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      }),
    });
    const t = await res.json();

    if (!res.ok) {
      if (t.error === 'invalid_grant') {
        throw new Error('Google has expired this connection (Testing mode lasts 7 days). '
                      + 'Open Credentials and press Connect again.');
      }
      throw new Error(`Refresh failed: ${t.error_description ?? t.error}`);
    }

    const merged = { ...saved, ...t, refresh_token: t.refresh_token ?? saved.refresh_token };
    const expiresAt = Date.now() + (Number(t.expires_in) || 3600) * 1000;
    await store.save(credentialId, merged, new Date(expiresAt));
    cache.set(credentialId, { token: t.access_token, expiresAt });
    return t.access_token;
  })().finally(() => inFlight.delete(credentialId));

  inFlight.set(credentialId, pending);
  return pending;
}
