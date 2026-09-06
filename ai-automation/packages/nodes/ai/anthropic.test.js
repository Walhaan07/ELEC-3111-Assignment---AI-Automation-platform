import { test, expect, describe, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { aiNode, parseJsonAnswer, MODELS } from './anthropic.js';

/**
 * The AI node, against a fake model server.
 *
 * No API key, no cost, no network, and the awkward cases - prose instead of
 * JSON, a missing key, an overloaded model - are all reproducible on demand.
 */

let server;
let base;
let calls = [];
let reply;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      calls.push({ url: req.url, key: req.headers['x-api-key'],
                   version: req.headers['anthropic-version'], body: JSON.parse(body || '{}') });
      const answer = reply(calls.length);
      res.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => { await new Promise((done) => server.close(done)); });

const say = (text, extra = {}) => ({
  status: 200,
  body: {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 412, output_tokens: 38 },
    model: 'claude-sonnet-5',
    ...extra,
  },
});

beforeEach(() => {
  calls = [];
  reply = () => say('{"urgency":"urgent","reason":"payment failed twice"}');
});

const ctxFor = (parameters, items = [{ json: { body: { message: 'my card was declined twice' } } }]) => ({
  getInputData: () => items,
  getNodeParameter: (name, _i, fallback) => parameters[name] ?? fallback,
  credentials: { anthropicApi: { apiKey: 'test-key', baseUrl: base } },
  logger: { info() {}, warn() {} },
});

const defaults = {
  model: 'claude-sonnet-5',
  userPrompt: 'Classify: my card was declined twice',
  maxTokens: 512,
  expectJson: true,
  requiredKeys: 'urgency',
};

describe('asking the model', () => {
  test('the answer is parsed and merged into the item', async () => {
    const [out] = await aiNode.execute(ctxFor(defaults));
    expect(out[0].json).toMatchObject({ urgency: 'urgent', reason: 'payment failed twice' });
    expect(out[0].json.body.message).toBe('my card was declined twice');   // the item survives
    expect(out[0].pairedItem).toBe(0);
  });

  test('the request carries the key, the version header and the settings', async () => {
    await aiNode.execute(ctxFor({ ...defaults, systemPrompt: 'Answer with JSON only.' }));
    const call = calls[0];
    expect(call.url).toBe('/v1/messages');
    expect(call.key).toBe('test-key');
    expect(call.version).toBe('2023-06-01');
    expect(call.body.model).toBe('claude-sonnet-5');
    expect(call.body.system).toBe('Answer with JSON only.');
    expect(call.body.messages).toEqual([{ role: 'user', content: defaults.userPrompt }]);
  });

  test('max_tokens is clamped into the range the API accepts', async () => {
    await aiNode.execute(ctxFor({ ...defaults, maxTokens: 99_999 }));
    expect(calls[0].body.max_tokens).toBe(4096);

    calls = [];
    await aiNode.execute(ctxFor({ ...defaults, maxTokens: -5 }));
    expect(calls[0].body.max_tokens).toBe(1);
  });

  test('an empty system prompt is left out rather than sent blank', async () => {
    await aiNode.execute(ctxFor({ ...defaults, systemPrompt: '' }));
    expect(calls[0].body).not.toHaveProperty('system');
  });

  test('expectJson off keeps the raw text', async () => {
    reply = () => say('Sure! Here is the answer: it is urgent.');
    const [out] = await aiNode.execute(ctxFor({ ...defaults, expectJson: false }));
    expect(out[0].json.answer).toBe('Sure! Here is the answer: it is urgent.');
  });

  test('every item gets its own request', async () => {
    const items = [{ json: { n: 1 } }, { json: { n: 2 } }];
    await aiNode.execute(ctxFor(defaults, items));
    expect(calls).toHaveLength(2);
  });
});

describe('when things go wrong', () => {
  test('an overloaded model is waited out, then succeeds', async () => {
    reply = (n) => (n === 1
      ? { status: 529, headers: { 'retry-after': '0' }, body: { error: { message: 'overloaded' } } }
      : say('{"urgency":"routine"}'));

    const [out] = await aiNode.execute(ctxFor(defaults));
    expect(out[0].json.urgency).toBe('routine');
    expect(calls).toHaveLength(2);
  });

  test('a 400 is reported with the API message, not retried forever', async () => {
    reply = () => ({ status: 400, body: { error: { message: 'model not found' } } });
    await expect(aiNode.execute(ctxFor(defaults))).rejects.toThrow(/AI 400: model not found/);
    expect(calls).toHaveLength(1);
  });

  test('prose instead of JSON says what the model actually said', async () => {
    reply = () => say('I think this one is quite urgent, really.');
    await expect(aiNode.execute(ctxFor(defaults)))
      .rejects.toThrow(/did not return JSON. It said: I think this one/);
  });

  test('a missing key in the answer is named', async () => {
    reply = () => say('{"reason":"no urgency field here"}');
    await expect(aiNode.execute(ctxFor(defaults))).rejects.toThrow(/missing: urgency/);
  });

  test('a prompt that is far too long is refused before it is sent', async () => {
    await expect(aiNode.execute(ctxFor({ ...defaults, userPrompt: 'x'.repeat(20_001) })))
      .rejects.toThrow(/Prompt is too long/);
    expect(calls).toHaveLength(0);
  });

  test('no API key at all is a sentence, not a stack trace', async () => {
    const ctx = ctxFor(defaults);
    ctx.credentials = {};
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(aiNode.execute(ctx)).rejects.toThrow(/No API key for the AI node/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe('reading the answer', () => {
  test('a fenced code block is unwrapped', () => {
    expect(parseJsonAnswer('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  test('JSON with chatter around it is still found', () => {
    expect(parseJsonAnswer('Sure. {"a":1} Hope that helps!')).toEqual({ a: 1 });
  });

  test('required keys are checked', () => {
    expect(() => parseJsonAnswer('{"a":1}', ['a', 'b'])).toThrow(/missing: b/);
    expect(parseJsonAnswer('{"a":1,"b":2}', ['a', 'b'])).toEqual({ a: 1, b: 2 });
  });

  test('the models offered in the sidebar are real ids', () => {
    expect(MODELS.map((m) => m.value)).toEqual(
      expect.arrayContaining(['claude-opus-5', 'claude-sonnet-5']));
  });
});
