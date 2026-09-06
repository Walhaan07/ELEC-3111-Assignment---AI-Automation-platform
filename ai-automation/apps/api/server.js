import { pathToFileURL } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './env.js';
import { db } from './db.js';
import { runById, reapStuckExecutions, runnerStats } from './runner.js';
import { restoreAll, listSchedules, stopAll } from './schedules.js';
import { setActive, findTriggerNode } from './activation.js';
import { mountWebhooks } from './webhooks.js';
import { mountOAuth, SCOPES } from './oauth.js';
import { connectCredentialStore } from './credentials.js';
import { streamEvents } from './events.js';
import { nodeDescriptions, nodeTypes } from '@ai-automation/nodes';
import { validateWorkflow, WorkflowError } from '@ai-automation/engine';
import { toErrorPayload } from '@ai-automation/engine/errors.js';

export const app = express();

app.use(helmet({ contentSecurityPolicy: false }));      // sane security headers, free
app.use(cors({ origin: config.editorOrigin.split(',').map((o) => o.trim()) }));
app.use('/rest', express.json({ limit: '2mb' }));       // a 900 MB body must not eat the server
app.use('/rest', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));

// ---- small helpers -------------------------------------------------------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// every route is wrapped: a rejected promise becomes a clean error, never a crash
const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requireId(req) {
  if (!UUID.test(req.params.id)) throw new HttpError(400, 'That is not a valid workflow id');
  return req.params.id;
}

function validateWorkflowBody(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new HttpError(400, 'name is required');
    if (body.name.length > 120) throw new HttpError(400, 'name must be 120 characters or fewer');
    out.name = body.name.trim();
  }
  if (!partial || body.nodes !== undefined) {
    if (!Array.isArray(body.nodes)) throw new HttpError(400, 'nodes must be an array');
    for (const node of body.nodes) {
      if (!node?.name || typeof node.name !== 'string') throw new HttpError(400, 'every node needs a name');
      if (!node?.type || typeof node.type !== 'string') throw new HttpError(400, `"${node.name}" needs a type`);
    }
    out.nodes = body.nodes;
  }
  if (!partial || body.connections !== undefined) {
    if (typeof body.connections !== 'object' || body.connections === null || Array.isArray(body.connections)) {
      throw new HttpError(400, 'connections must be an object');
    }
    out.connections = body.connections;
  }
  return out;
}

// ---- the routes ----------------------------------------------------------

app.get('/healthz', route(async (req, res) => {
  await db.query('SELECT 1');
  res.json({ ok: true, uptime: Math.round(process.uptime()), runner: runnerStats() });
}));

// 1 - list
app.get('/rest/workflows', route(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { rows } = await db.query(
    'SELECT id, name, active, version, updated_at, jsonb_array_length(nodes) AS node_count '
    + 'FROM workflows ORDER BY updated_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
  res.json({ data: rows, limit, offset });
}));

// 2 - fetch one
app.get('/rest/workflows/:id', route(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM workflows WHERE id = $1', [requireId(req)]);
  if (!rows[0]) throw new HttpError(404, 'No workflow with that id');
  const webhook = rows[0].active
    ? (await db.query('SELECT path, method, response_mode FROM webhooks WHERE workflow_id = $1 AND is_test = false',
                      [rows[0].id])).rows[0] ?? null
    : null;
  res.json({ ...rows[0], webhookUrl: webhook ? `${config.baseUrl}/webhook/${webhook.path}` : null });
}));

// 3 - create
app.post('/rest/workflows', route(async (req, res) => {
  const wf = validateWorkflowBody(req.body);
  const { rows } = await db.query(
    'INSERT INTO workflows (name, nodes, connections) VALUES ($1, $2, $3) RETURNING *',
    [wf.name, JSON.stringify(wf.nodes ?? []), JSON.stringify(wf.connections ?? {})]);
  res.status(201).json(rows[0]);
}));

// 4 - save
app.patch('/rest/workflows/:id', route(async (req, res) => {
  const id = requireId(req);
  const wf = validateWorkflowBody(req.body, { partial: true });

  // optimistic locking: the editor sends the version it loaded. If somebody else saved
  // in between, the UPDATE matches nothing and we say so instead of eating their work.
  const { rows } = await db.query(
    `UPDATE workflows SET name        = COALESCE($2, name),
                          nodes       = COALESCE($3, nodes),
                          connections = COALESCE($4, connections)
     WHERE id = $1 AND ($5::int IS NULL OR version = $5) RETURNING *`,
    [id, wf.name ?? null,
     wf.nodes ? JSON.stringify(wf.nodes) : null,
     wf.connections ? JSON.stringify(wf.connections) : null,
     req.body.version ?? null]);

  if (!rows[0]) {
    const { rowCount } = await db.query('SELECT 1 FROM workflows WHERE id = $1', [id]);
    if (!rowCount) throw new HttpError(404, 'No workflow with that id');
    throw new HttpError(409, 'Somebody else saved this workflow - reload before saving');
  }
  res.json(rows[0]);
}));

app.delete('/rest/workflows/:id', route(async (req, res) => {
  const id = requireId(req);
  const { rowCount } = await db.query('DELETE FROM workflows WHERE id = $1', [id]);
  if (!rowCount) throw new HttpError(404, 'No workflow with that id');
  res.status(204).end();
}));

// 5 - run
app.post('/rest/workflows/:id/run', route(async (req, res) => {
  const id = requireId(req);
  try {
    const result = await runById(id, req.body?.triggerItems ?? undefined, 'manual');
    res.json({ executionId: result.executionId, status: 'success', data: result.results, log: result.log });
  } catch (err) {
    const payload = toErrorPayload(err);
    const status = payload.code === 'NOT_FOUND' ? 404 : 422;
    res.status(status).json({ executionId: err.executionId ?? null, status: 'error', error: payload });
  }
}));

// on / off
app.post('/rest/workflows/:id/activate', route(async (req, res) => {
  const summary = await setActive(requireId(req), req.body?.active !== false);
  res.json(summary);
}));

// live progress for the canvas
app.get('/rest/workflows/:id/events', (req, res) => streamEvents(req, res));

// what can go wrong, before you press Run
app.get('/rest/workflows/:id/validate', route(async (req, res) => {
  const { rows: [wf] } = await db.query('SELECT * FROM workflows WHERE id = $1', [requireId(req)]);
  if (!wf) throw new HttpError(404, 'No workflow with that id');
  try {
    validateWorkflow(wf, nodeTypes);
    res.json({ ok: true, trigger: findTriggerNode(wf)?.name ?? null, problems: [] });
  } catch (err) {
    res.json({ ok: false, problems: String(err.message).split('\n').slice(1).map((l) => l.replace(/^\s*-\s*/, '')) });
  }
}));

// executions
app.get('/rest/executions', route(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const workflowId = req.query.workflowId;
  if (workflowId && !UUID.test(String(workflowId))) throw new HttpError(400, 'workflowId is not a valid id');

  const { rows } = await db.query(
    `SELECT e.id, e.workflow_id, w.name AS workflow_name, e.mode, e.status, e.error,
            e.started_at, e.finished_at
     FROM executions e JOIN workflows w ON w.id = e.workflow_id
     ${workflowId ? 'WHERE e.workflow_id = $2' : ''}
     ORDER BY e.started_at DESC LIMIT $1`,
    workflowId ? [limit, workflowId] : [limit]);

  res.json({ data: rows.map((r) => ({
    ...r,
    ms: r.finished_at ? new Date(r.finished_at) - new Date(r.started_at) : null,
  })) });
}));

app.get('/rest/executions/:id', route(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(400, 'That is not a valid execution id');
  const { rows } = await db.query('SELECT * FROM executions WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'No execution with that id');
  res.json(rows[0]);
}));

// every node description, which is what the editor builds its whole UI from
app.get('/rest/node-types', (req, res) => {
  res.set('cache-control', 'public, max-age=60');       // it changes only when we deploy
  res.json(nodeDescriptions());
});

// credentials: the list, and creating an empty one to connect
app.get('/rest/credentials', route(async (req, res) => {
  const { rows } = await db.query(
    'SELECT id, name, type, scopes, expires_at, created_at, (data IS NOT NULL) AS connected '
    + 'FROM credentials ORDER BY created_at DESC');
  res.json({ data: rows, googleReady: config.googleReady, types: Object.keys(SCOPES) });
}));

app.post('/rest/credentials', route(async (req, res) => {
  const { name, type } = req.body ?? {};
  if (!name || typeof name !== 'string') throw new HttpError(400, 'name is required');
  if (!SCOPES[type] && type !== 'anthropicApi') throw new HttpError(400, `Unknown credential type "${type}"`);
  const { rows } = await db.query(
    'INSERT INTO credentials (name, type) VALUES ($1,$2) RETURNING id, name, type, created_at',
    [name.trim(), type]);
  res.status(201).json(rows[0]);
}));

app.delete('/rest/credentials/:id', route(async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(400, 'That is not a valid credential id');
  const { rowCount } = await db.query('DELETE FROM credentials WHERE id = $1', [req.params.id]);
  if (!rowCount) throw new HttpError(404, 'No credential with that id');
  res.status(204).end();
}));

app.get('/rest/schedules', (req, res) => res.json({ data: listSchedules() }));

mountOAuth(app, { route, HttpError });
mountWebhooks(app);

// ---- the two middlewares every Express app should end with ---------------
app.use((req, res) => res.status(404).json({ message: `No route for ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status ?? (err instanceof WorkflowError ? 400 : 500);
  if (status >= 500) console.error('[api]', err);       // log the stack, show the user nothing
  res.status(status).json({ message: status >= 500 ? 'Internal error' : err.message });
});

// ---- start, and stop politely -------------------------------------------
export async function start() {
  connectCredentialStore();
  await reapStuckExecutions();
  await restoreAll();

  const server = app.listen(config.port, () => {
    console.log(`api on http://localhost:${config.port}`);
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      console.log(`\n${signal} - finishing in-flight requests...`);
      stopAll();
      server.close(async () => { await db.end(); process.exit(0); });
      setTimeout(() => process.exit(1), 10_000).unref();   // but never hang forever
    });
  }
  return server;
}

// `node server.js` starts it; `import { app }` in a test does not.
//
// pathToFileURL, not string concatenation: on Windows argv[1] is
// C:\Users\you\server.js while import.meta.url is file:///C:/Users/you/server.js,
// so `file://` + argv[1] never matches and the server would define everything
// and then exit without ever listening.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start().catch((err) => {
    console.error('could not start:', err.message);
    process.exit(1);
  });
}
