/**
 * One HTTP helper, with a timeout and a retry, used by every node forever.
 *
 * Written once so no node author ever has to think about flaky networks again.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      const type = res.headers.get('content-type') || '';
      return type.includes('json') ? await res.json() : { data: await res.text() };
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
