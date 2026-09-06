import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import { app } from './server.js';
import { db } from './db.js';
import { connectCredentialStore } from './credentials.js';
import { stopAll } from './schedules.js';

/**
 * Level 2b - the API against a real database.
 *
 * The five status codes are the deliverable here, not the 201. Anybody can
 * write a route that works; a marker looks at what happens when it does not.
 *
 * Needs Postgres and a migrated schema:  npm run migrate
 */

let server;
let base;
const created = [];

beforeAll(async () => {
  connectCredentialStore();
  server = app.listen(0);
  await new Promise((done) => server.once('listening', done));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  stopAll();
  for (const id of created) await db.query('DELETE FROM workflows WHERE id = $1', [id]);
  await new Promise((done) => server.close(done));
  await db.end();
});

const request = async (path, init = {}) => {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const text = await res.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  return { status: res.status, body };
};

const makeWorkflow = async (nodes = [], connections = {}, name = `test ${Date.now()}-${Math.random()}`) => {
  const res = await request('/rest/workflows', {
    method: 'POST',
    body: JSON.stringify({ name, nodes, connections }),
  });
  created.push(res.body.id);
  return res.body;
};

describe('health and catalogue', () => {
  test('healthz proves the database is reachable', async () => {
    const { status, body } = await request('/healthz');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  test('every node description is served to the editor', async () => {
    const { status, body } = await request('/rest/node-types');
    expect(status).toBe(200);
    expect(body.map((d) => d.name)).toEqual(expect.arrayContaining(
      ['manualTrigger', 'webhook', 'schedule', 'httpRequest', 'set', 'if', 'merge', 'code',
       'googleSheets', 'googleDocs', 'googleDrive', 'gmail', 'ai']));
    // a description must never carry executable code to the browser
    expect(JSON.stringify(body)).not.toContain('execute');
  });
});

describe('the five guards, in order', () => {
  test('201 - a good create', async () => {
    const wf = await makeWorkflow();
    expect(wf.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(wf.version).toBe(1);
  });

  test('400 - no name', async () => {
    const { status, body } = await request('/rest/workflows', {
      method: 'POST', body: JSON.stringify({ nodes: [], connections: {} }),
    });
    expect(status).toBe(400);
    expect(body.message).toMatch(/name is required/);
  });

  test('400 - the id is not a uuid', async () => {
    const { status, body } = await request('/rest/workflows/not-an-id');
    expect(status).toBe(400);
    expect(body.message).toMatch(/not a valid workflow id/);
  });

  test('404 - an unknown id', async () => {
    const { status, body } = await request('/rest/workflows/00000000-0000-4000-8000-000000000000');
    expect(status).toBe(404);
    expect(body.message).toMatch(/No workflow with that id/);
  });

  test('409 - somebody else saved first', async () => {
    const wf = await makeWorkflow();
    const first = await request(`/rest/workflows/${wf.id}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'renamed once', version: wf.version }),
    });
    expect(first.status).toBe(200);
    expect(first.body.version).toBe(2);       // the trigger bumped it

    const stale = await request(`/rest/workflows/${wf.id}`, {
      method: 'PATCH', body: JSON.stringify({ name: 'renamed twice', version: wf.version }),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.message).toMatch(/reload before saving/);
  });

  test('422 - the engine refused the workflow', async () => {
    const wf = await makeWorkflow();                 // no nodes at all
    const { status, body } = await request(`/rest/workflows/${wf.id}/run`, { method: 'POST' });
    expect(status).toBe(422);
    expect(body.error.code).toBe('INVALID_WORKFLOW');
    expect(body.error.message).toMatch(/no nodes/);
  });

  test('404 - a route that does not exist', async () => {
    const { status, body } = await request('/rest/nothing-here');
    expect(status).toBe(404);
    expect(body.message).toMatch(/No route for GET/);
  });
});

describe('running a workflow', () => {
  const trivial = [
    { name: 'Start', type: 'manualTrigger', parameters: {} },
    { name: 'Shape', type: 'set',
      parameters: { keepOnlySet: true, fields: [{ name: 'greeting', type: 'string', value: 'hello {{ $json.who }}' }] } },
  ];

  test('a manual run records an execution and returns the data', async () => {
    const wf = await makeWorkflow(trivial, { Start: [['Shape']] });
    const { status, body } = await request(`/rest/workflows/${wf.id}/run`, { method: 'POST' });

    expect(status).toBe(200);
    expect(body.status).toBe('success');
    expect(body.data.Shape[0][0].json.greeting).toBe('hello ');
    expect(body.log.filter((l) => l.level === 'done')).toHaveLength(2);

    const runs = await request(`/rest/executions?workflowId=${wf.id}`);
    expect(runs.body.data).toHaveLength(1);
    expect(runs.body.data[0].status).toBe('success');
    expect(runs.body.data[0].mode).toBe('manual');
    expect(runs.body.data[0].ms).toBeGreaterThanOrEqual(0);
  });

  test('trigger data reaches the first node, and expressions see it', async () => {
    const wf = await makeWorkflow(trivial, { Start: [['Shape']] });
    const { body } = await request(`/rest/workflows/${wf.id}/run`, {
      method: 'POST',
      body: JSON.stringify({ triggerItems: [{ json: { who: 'Newcastle' } }] }),
    });
    expect(body.data.Shape[0][0].json.greeting).toBe('hello Newcastle');
  });

  test('a failing node is stored with its name, and the run is marked error', async () => {
    const wf = await makeWorkflow([
      { name: 'Start', type: 'manualTrigger', parameters: {} },
      { name: 'Boom', type: 'httpRequest', parameters: { url: 'not-a-url', method: 'GET' } },
    ], { Start: [['Boom']] });

    const { status, body } = await request(`/rest/workflows/${wf.id}/run`, { method: 'POST' });
    expect(status).toBe(422);
    expect(body.error.node).toBe('Boom');
    expect(body.error.message).toMatch(/must start with http/);

    const runs = await request(`/rest/executions?workflowId=${wf.id}`);
    expect(runs.body.data[0].status).toBe('error');
    expect(runs.body.data[0].error.node).toBe('Boom');
  });

  test('validate says what is wrong without running anything', async () => {
    const wf = await makeWorkflow([{ name: 'Lonely', type: 'set', parameters: {} }], {});
    const { body } = await request(`/rest/workflows/${wf.id}/validate`);
    expect(body.ok).toBe(false);
    expect(body.problems.join(' ')).toMatch(/exactly one trigger/);

    const runs = await request(`/rest/executions?workflowId=${wf.id}`);
    expect(runs.body.data).toHaveLength(0);      // nothing ran
  });
});

describe('activation, webhooks and schedules', () => {
  test('a webhook workflow claims its address, answers it, and gives it back', async () => {
    const path = `test-${Date.now()}`;
    const wf = await makeWorkflow([
      { name: 'Hook', type: 'webhook', parameters: { path, method: 'POST', responseMode: 'lastNode' } },
      { name: 'Echo', type: 'set',
        parameters: { keepOnlySet: true, fields: [
          { name: 'received', type: 'string', value: '{{ $json.body.order }}' },
          { name: 'ok', type: 'boolean', value: 'true' },
        ] } },
    ], { Hook: [['Echo']] });

    const on = await request(`/rest/workflows/${wf.id}/activate`, {
      method: 'POST', body: JSON.stringify({ active: true }),
    });
    expect(on.status).toBe(200);
    expect(on.body.trigger).toMatchObject({ kind: 'webhook', path, method: 'POST' });

    const fired = await request(`/webhook/${path}`, {
      method: 'POST', body: JSON.stringify({ order: 'A-1042' }),
    });
    expect(fired.status).toBe(200);
    expect(fired.body).toEqual({ received: 'A-1042', ok: true });

    // the same delivery twice must not do the work twice
    const key = `idem-${Date.now()}`;
    const once = await request(`/webhook/${path}`, {
      method: 'POST', headers: { 'idempotency-key': key }, body: JSON.stringify({ order: 'A-2' }),
    });
    expect(once.status).toBe(200);
    const twice = await request(`/webhook/${path}`, {
      method: 'POST', headers: { 'idempotency-key': key }, body: JSON.stringify({ order: 'A-2' }),
    });
    expect(twice.status).toBe(200);
    expect(twice.body.message).toMatch(/Already handled/);

    const runs = await request(`/rest/executions?workflowId=${wf.id}`);
    expect(runs.body.data.filter((r) => r.mode === 'webhook')).toHaveLength(2);   // not three

    const off = await request(`/rest/workflows/${wf.id}/activate`, {
      method: 'POST', body: JSON.stringify({ active: false }),
    });
    expect(off.body.active).toBe(false);

    const gone = await request(`/webhook/${path}`, { method: 'POST', body: '{}' });
    expect(gone.status).toBe(404);
    expect(gone.body.message).toMatch(/No workflow is listening here/);
  });

  test('two workflows cannot claim the same address', async () => {
    const path = `clash-${Date.now()}`;
    const nodes = (name) => [{ name, type: 'webhook', parameters: { path, method: 'POST' } }];

    const first = await makeWorkflow(nodes('Hook'), {});
    const second = await makeWorkflow(nodes('Hook'), {});

    const a = await request(`/rest/workflows/${first.id}/activate`, {
      method: 'POST', body: JSON.stringify({ active: true }),
    });
    expect(a.status).toBe(200);

    const b = await request(`/rest/workflows/${second.id}/activate`, {
      method: 'POST', body: JSON.stringify({ active: true }),
    });
    expect(b.status).toBe(409);
    expect(b.body.message).toMatch(/already listens on/);
  });

  test('an invalid cron is refused before the timer is created', async () => {
    const wf = await makeWorkflow([
      { name: 'Clock', type: 'schedule', parameters: { cron: 'not a cron', timezone: 'UTC' } },
    ], {});
    const { status, body } = await request(`/rest/workflows/${wf.id}/activate`, {
      method: 'POST', body: JSON.stringify({ active: true }),
    });
    expect(status).toBe(400);
    expect(body.message).toMatch(/cron/i);
  });

  test('a valid schedule registers a timer and reports the next run', async () => {
    const wf = await makeWorkflow([
      { name: 'Clock', type: 'schedule', parameters: { cron: '0 3 * * *', timezone: 'Australia/Sydney' } },
      { name: 'Work', type: 'set', parameters: { fields: [] } },
    ], { Clock: [['Work']] });

    const on = await request(`/rest/workflows/${wf.id}/activate`, {
      method: 'POST', body: JSON.stringify({ active: true }),
    });
    expect(on.body.trigger.kind).toBe('schedule');
    expect(new Date(on.body.trigger.next).getTime()).toBeGreaterThan(Date.now());

    const list = await request('/rest/schedules');
    expect(list.body.data.some((s) => s.workflowId === wf.id)).toBe(true);

    await request(`/rest/workflows/${wf.id}/activate`, {
      method: 'POST', body: JSON.stringify({ active: false }),
    });
    const after = await request('/rest/schedules');
    expect(after.body.data.some((s) => s.workflowId === wf.id)).toBe(false);
  });

  test('a manual-trigger workflow cannot be activated, and says why', async () => {
    const wf = await makeWorkflow([{ name: 'Start', type: 'manualTrigger', parameters: {} }], {});
    const { status, body } = await request(`/rest/workflows/${wf.id}/activate`, {
      method: 'POST', body: JSON.stringify({ active: true }),
    });
    expect(status).toBe(400);
    expect(body.message).toMatch(/Manual Trigger runs from the Run button/);
  });
});

describe('credentials', () => {
  test('a credential is created disconnected, and never leaks its data', async () => {
    const made = await request('/rest/credentials', {
      method: 'POST', body: JSON.stringify({ name: `test ${Date.now()}`, type: 'googleSheets' }),
    });
    expect(made.status).toBe(201);

    const list = await request('/rest/credentials');
    const row = list.body.data.find((c) => c.id === made.body.id);
    expect(row.connected).toBe(false);
    expect(row).not.toHaveProperty('data');

    const removed = await request(`/rest/credentials/${made.body.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
  });

  test('an unknown credential type is refused', async () => {
    const { status } = await request('/rest/credentials', {
      method: 'POST', body: JSON.stringify({ name: 'x', type: 'facebook' }),
    });
    expect(status).toBe(400);
  });
});
