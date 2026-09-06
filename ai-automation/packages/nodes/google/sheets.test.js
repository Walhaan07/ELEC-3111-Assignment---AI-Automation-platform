import { test, expect, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { sheetsNode, parseSheetId, quoteSheetName } from './sheets.js';
import { useCredentialStore, forgetCredential } from './request.js';

/**
 * Level 2 - a node against a fake Google, with no internet.
 *
 * The node calls a local address instead of Google's, so this runs in about a
 * second, needs no credentials, no quota and no network.
 */

let server;
let calls = [];
let nextStatus = 200;
const PORT = 4010;

beforeAll(async () => {
  process.env.GOOGLE_API_BASE = `http://127.0.0.1:${PORT}`;

  // a credential store that hands out a token without touching Postgres
  useCredentialStore({
    async load() { return { access_token: 'fake-token', refresh_token: 'fake-refresh', expires_in: 3600 }; },
    async save() {},
  });

  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      // the token endpoint is form-encoded, everything else is JSON
      let parsed;
      try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = { raw: body }; }
      calls.push({ url: req.url, method: req.method, auth: req.headers.authorization, body: parsed });

      if (req.url.includes('/token')) {          // the OAuth refresh
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ access_token: 'fresh-token', expires_in: 3600 }));
      }
      if (nextStatus !== 200) {                  // let a test ask for a failure
        res.writeHead(nextStatus, { 'retry-after': '0', 'content-type': 'application/json' });
        // Google's real wording, because the helper reads it to tell a scope
        // problem apart from a rate limit
        return res.end(nextStatus === 403
          ? '{"error":{"message":"Request had insufficient authentication scopes."}}'
          : '{"error":{"message":"Quota exceeded"}}');
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        values: [['name', 'email']],
        updates: { updatedRows: 1, updatedRange: 'Orders!A18' },
      }));
    });
  });
  await new Promise((done) => server.listen(PORT, '127.0.0.1', done));
});

afterAll(async () => {
  delete process.env.GOOGLE_API_BASE;
  await new Promise((done) => server.close(done));
});

beforeEach(() => { calls = []; nextStatus = 200; forgetCredential(); });

const makeCtx = ({ items = 1, columns, ...params } = {}) => {
  const input = Array.from({ length: items }, (_, i) => ({ json: { name: `Person ${i}`, email: `p${i}@example.com` } }));
  const values = {
    operation: 'append',
    documentId: 'https://docs.google.com/spreadsheets/d/ABC123DEF456GHI789/edit',
    sheetName: 'Orders',
    ...params,
  };
  return {
    credentialId: 'cred-1',
    getInputData: () => input,
    getNodeParameter: (name, i, fallback) => {
      if (name === 'columns') {
        return columns ?? { name: input[i].json.name, email: input[i].json.email };
      }
      return values[name] ?? fallback;
    },
    logger: { info() {}, warn() {} },
  };
};

describe('Google Sheets', () => {
  test('append sends one row, in header order, to the right range', async () => {
    await sheetsNode.execute(makeCtx({ columns: { email: 'a@example.com', name: 'Alice' } }));
    const write = calls.at(-1);

    expect(write.method).toBe('POST');
    expect(write.url).toContain('/ABC123DEF456GHI789/values/');
    expect(write.url).toContain('valueInputOption=USER_ENTERED');
    expect(write.body.values).toEqual([['Alice', 'a@example.com']]);   // sheet order, not object order
  });

  test('the request carries a bearer token', async () => {
    await sheetsNode.execute(makeCtx());
    expect(calls.at(-1).auth).toMatch(/^Bearer /);
  });

  test('three items become ONE append request', async () => {
    await sheetsNode.execute(makeCtx({ items: 3 }));
    expect(calls.filter((c) => c.method === 'POST' && c.url.includes(':append'))).toHaveLength(1);
  });

  test('a 429 is retried, not thrown', async () => {
    nextStatus = 429;
    setTimeout(() => { nextStatus = 200; }, 30);        // recover after the first retry
    await expect(sheetsNode.execute(makeCtx())).resolves.toBeDefined();
    expect(calls.length).toBeGreaterThan(1);
  });

  test('a scope problem says what is actually wrong', async () => {
    nextStatus = 403;
    await expect(sheetsNode.execute(makeCtx()))
      .rejects.toThrow(/was not granted the scope/);
  });

  test('read returns one item per row, keyed by the header', async () => {
    const [out] = await sheetsNode.execute(makeCtx({ operation: 'read' }));
    expect(out).toEqual([]);        // the fake sheet has a header row and no data rows
  });

  test('no items means no request at all', async () => {
    const ctx = makeCtx();
    ctx.getInputData = () => [];
    const [out] = await sheetsNode.execute(ctx);
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('the small pieces that bite', () => {
  test('a sheet name with an apostrophe is quoted properly', () => {
    expect(quoteSheetName("Bob's list")).toBe("'Bob''s list'");
  });

  test('a full URL and a bare id both work', () => {
    expect(parseSheetId('https://docs.google.com/spreadsheets/d/ABC123DEF456GHI789/edit#gid=0'))
      .toBe('ABC123DEF456GHI789');
    expect(parseSheetId('ABC123DEF456GHI789')).toBe('ABC123DEF456GHI789');
  });

  test('something that is not a spreadsheet says so', () => {
    expect(() => parseSheetId('hello')).toThrow(/is not a spreadsheet id or URL/);
  });
});
