/**
 * One HTTP helper, with a timeout and a retry, used by every node forever.
 *
 * Written once so no node author ever has to think about flaky networks again.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Read a response body by what it IS, not only by what it says it is.
 *
 * Plenty of real endpoints send JSON labelled text/plain - wttr.in's ?format=j1
 * is the one in our own starter workflow. Trusting the header alone hands the
 * next node { data: "{\"current_condition\":…" }, and every expression written
 * against the real shape fails with "cannot read properties of undefined".
 *
 * Anything that is not JSON still arrives as { data: "…" }, unchanged.
 */
export function parseBody(text, contentType = '') {
  if (text === '') return {};

  const looksLikeJson = /^\s*[[{]/.test(text);
  if (contentType.includes('json') || looksLikeJson) {
    try {
      const parsed = JSON.parse(text);
      // a bare string or number is not an object the next node can read fields
      // from, so it keeps the { data } wrapper
      return parsed !== null && typeof parsed === 'object' ? parsed : { data: parsed };
    } catch {
      // labelled JSON but broken, or text that merely started with a brace
      return { data: text };
    }
  }
  return { data: text };
}

export async function httpRequest(url, opts = {}) {
  const { retries = 3, timeoutMs = 30000, ...init } = opts;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

      // 429 = "you are going too fast", 5xx = "my fault" - both are worth trying again
      if (res.status === 429 || res.status >= 500) {
        const after = Number(res.headers.get('retry-after')) * 1000;
        throw Object.assign(new Error(`HTTP ${res.status}`), {
          retryAfter: Number.isFinite(after) ? after : 0,
          status: res.status,
        });
      }

      // 4xx = "your fault" - retrying changes nothing, so stop immediately
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        throw Object.assign(new Error(`HTTP ${res.status}: ${body}`), { fatal: true, status: res.status });
      }

      if (res.status === 204) return {};
      return parseBody(await res.text(), res.headers.get('content-type') || '');
    } catch (err) {
      lastError = err;
      if (err.fatal || attempt === retries) break;
      // exponential backoff with jitter: 0.5s, 1s, 2s ... plus a random nudge so eight
      // parallel items do not all wake up and hammer the server at the same millisecond
      await sleep(err.retryAfter || Math.min(8000, 2 ** attempt * 500) + Math.random() * 250);
    }
  }
  throw lastError;
}
