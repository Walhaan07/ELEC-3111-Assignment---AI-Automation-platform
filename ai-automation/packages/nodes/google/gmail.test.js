import { test, expect, describe } from 'vitest';
import { buildMime, encodeHeader, addressList, base64url, gmailNode } from './gmail.js';

/**
 * Gmail is the fiddliest node, so it gets the most tests. Every one of these
 * is a real failure somebody hits the first time they build an email by hand.
 */

describe('addresses', () => {
  test('a list is trimmed and rejoined', () => {
    expect(addressList(' a@example.com ,b@example.com ', 'To')).toBe('a@example.com, b@example.com');
  });

  test('a bad address names itself', () => {
    expect(() => addressList('alice@', 'To')).toThrow(/To contains an invalid address: alice@/);
  });

  test('an empty field says which one it was', () => {
    expect(() => addressList('', 'Cc')).toThrow(/Cc is empty/);
  });
});

describe('headers', () => {
  test('plain ASCII is left alone', () => {
    expect(encodeHeader('Order 1042 received')).toBe('Order 1042 received');
  });

  test('an accented subject is RFC 2047 encoded, not sent raw', () => {
    const encoded = encodeHeader('Résumé');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    expect(Buffer.from(encoded.slice(10, -2), 'base64').toString('utf8')).toBe('Résumé');
  });
});

describe('the message itself', () => {
  const mime = buildMime({
    to: 'alice@example.com',
    cc: 'bob@example.com',
    subject: 'Hello',
    html: '<p>Hi Alice</p>',
  });

  test('carries the headers Gmail needs', () => {
    expect(mime).toContain('To: alice@example.com');
    expect(mime).toContain('Cc: bob@example.com');
    expect(mime).toContain('Subject: Hello');
    expect(mime).toContain('MIME-Version: 1.0');
    expect(mime).toContain('multipart/mixed; boundary=');
  });

  test('the body is base64, so any character survives the trip', () => {
    const encoded = Buffer.from('<p>Hi Alice</p>', 'utf8').toString('base64');
    expect(mime).toContain(encoded);
  });

  test('a reply keeps the thread, a new message does not', () => {
    expect(mime).not.toContain('In-Reply-To');
    const reply = buildMime({ to: 'a@example.com', subject: 'Re', html: 'x', inReplyTo: '<abc@mail>' });
    expect(reply).toContain('In-Reply-To: <abc@mail>');
    expect(reply).toContain('References: <abc@mail>');
  });

  test('an attachment gets its own part', () => {
    const withFile = buildMime({
      to: 'a@example.com', subject: 'Report', html: 'see attached',
      attachments: [{ fileName: 'report.csv', mimeType: 'text/csv', data: 'aGk=' }],
    });
    expect(withFile).toContain('Content-Disposition: attachment; filename="report.csv"');
    expect(withFile).toContain('text/csv');
  });

  test('base64url leaves nothing Gmail will reject', () => {
    expect(base64url('a>?b>?c>?')).not.toMatch(/[+/=]/);
  });
});

describe('dry run', () => {
  test('renders and validates without sending anything', async () => {
    const values = {
      to: 'alice@example.com', cc: '', subject: 'Rehearsal',
      html: '<p>nothing is sent</p>', inReplyTo: '', dryRun: true,
    };
    const ctx = {
      credentialId: null,           // deliberately absent: nothing may be sent
      getInputData: () => [{ json: {} }],
      getNodeParameter: (name, _i, fallback) => values[name] ?? fallback,
      logger: { info() {}, warn() {} },
    };

    const [out] = await gmailNode.execute(ctx);
    expect(out[0].json.dryRun).toBe(true);
    expect(out[0].json.preview).toContain('To: alice@example.com');
  });

  test('a bad address is caught before any credential is needed', async () => {
    const values = { to: 'not-an-address', subject: 'x', html: 'y', dryRun: true };
    const ctx = {
      credentialId: null,
      getInputData: () => [{ json: {} }],
      getNodeParameter: (name, _i, fallback) => values[name] ?? fallback,
      logger: { info() {}, warn() {} },
    };
    await expect(gmailNode.execute(ctx)).rejects.toThrow(/invalid address/);
  });
});
