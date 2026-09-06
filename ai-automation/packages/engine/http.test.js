import { test, expect, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { httpRequest } from './http.js';

/**
 * The shared HTTP helper.
 *
 * Every node in the platform reaches the network through this one function, so
 * a bug here is a bug in all thirteen of them at once. It gets its own tests.
 */

let server;
let base;
let handler;
let hits = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits += 1;
    handler(req, res);
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => { await new Promise((done) => server.close(done)); });

beforeEach(() => {
  hits = 0;
  handler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  };
});

describe('the happy path', () => {
  test('JSON comes back parsed', async () => {
    expect(await httpRequest(`${base}/x`)).toEqual({ ok: true });
  });

  test('anything else comes back as { data }', async () => {
    handler = (_req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('hello'); };
    expect(await httpRequest(`${base}/x`)).toEqual({ data: 'hello' });
  });

  test('204 No Content is an empty object, not a crash', async () => {
    handler = (_req, res) => { res.writeHead(204); res.end(); };
    expect(await httpRequest(`${base}/x`)).toEqual({});
  });

  test('the method, headers and body are sent as given', async () => {
    let seen;
    handler = (req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        seen = { method: req.method, key: req.headers['x-api-key'], body };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
    };
    await httpRequest(`${base}/x`, {
      method: 'POST', headers: { 'x-api-key': 'abc' }, body: '{"a":1}',
    });
    expect(seen).toEqual({ method: 'POST', key: 'abc', body: '{"a":1}' });
  });
});

describe('retrying, and not retrying', () => {
  test('a 500 is retried and can succeed', async () => {
    handler = (_req, res) => {
      if (hits < 3) { res.writeHead(500); return res.end('nope'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"recovered":true}');
    };
    expect(await httpRequest(`${base}/x`, { retries: 3 })).toEqual({ recovered: true });
    expect(hits).toBe(3);
  });

  test('a 429 is retried, and Retry-After is honoured', async () => {
    handler = (_req, res) => {
      if (hits < 2) { res.writeHead(429, { 'retry-after': '0' }); return res.end('slow down'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end('{"ok":true}');
    };
    expect(await httpRequest(`${base}/x`, { retries: 2 })).toEqual({ ok: true });
    expect(hits).toBe(2);
  });

  test('a 404 is NOT retried - retrying changes nothing', async () => {
    handler = (_req, res) => { res.writeHead(404); res.end('missing'); };
    await expect(httpRequest(`${base}/x`, { retries: 3 })).rejects.toThrow(/HTTP 404/);
    expect(hits).toBe(1);
  });

  test('the error body is included, so the message is useful', async () => {
    handler = (_req, res) => { res.writeHead(400); res.end('field "email" is required'); };
    await expect(httpRequest(`${base}/x`)).rejects.toThrow(/field "email" is required/);
  });

  test('giving up throws the last error, not a generic one', async () => {
    handler = (_req, res) => { res.writeHead(503); res.end('down'); };
    await expect(httpRequest(`${base}/x`, { retries: 1 })).rejects.toThrow(/HTTP 503/);
    expect(hits).toBe(2);
  });
});

describe('timeouts', () => {
  test('a slow server is cut off rather than hanging the run', async () => {
    handler = () => { /* never answers */ };
    await expect(httpRequest(`${base}/x`, { timeoutMs: 150, retries: 0 }))
      .rejects.toThrow(/timed out|abort/i);
  });

  test('a connection that is refused fails without retrying forever', async () => {
    await expect(httpRequest('http://127.0.0.1:9/nothing', { timeoutMs: 500, retries: 1 }))
      .rejects.toBeInstanceOf(Error);
  });
});
