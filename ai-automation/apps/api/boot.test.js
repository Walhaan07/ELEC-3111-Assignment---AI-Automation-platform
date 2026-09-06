import { test, expect, describe } from 'vitest';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Does `node apps/api/server.js` actually start listening?
 *
 * Every other test in this file imports `app` and calls listen() itself, so
 * they all passed while the real entry point was broken on Windows: the check
 * that decides whether to call start() compared `file://` + argv[1] against
 * import.meta.url, which can never match a Windows path. The server defined
 * every route and then exited without listening, and the editor showed
 * "Request failed (500)" with an ECONNREFUSED behind it.
 *
 * This test runs the server the way a person runs it, so that class of bug
 * cannot come back on any platform.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(here, 'server.js');
const PORT = 5699;

describe('starting the server for real', () => {
  test('node apps/api/server.js listens and answers /healthz', async () => {
    const child = spawn(process.execPath, [serverPath], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    child.stdout.on('data', (c) => { output += c; });
    child.stderr.on('data', (c) => { output += c; });

    try {
      const body = await waitForHealthz(`http://127.0.0.1:${PORT}/healthz`, child);
      expect(body.ok).toBe(true);
      expect(output).toMatch(new RegExp(`api on http://localhost:${PORT}`));
    } finally {
      child.kill('SIGKILL');
    }
  }, 30_000);
});

async function waitForHealthz(url, child) {
  const deadline = Date.now() + 20_000;
  let lastError = 'never answered';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`the server exited with code ${child.exitCode} instead of listening`);
    }
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return res.json();
      lastError = `HTTP ${res.status}`;
    } catch (e) {
      lastError = e.message;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the server never answered ${url}: ${lastError}`);
}
