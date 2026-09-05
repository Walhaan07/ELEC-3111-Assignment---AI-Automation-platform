# Build Guide — how to actually make this thing

For a team that has *used* n8n and knows HTML, JavaScript and Node.js, but has not built a system
like this before. Read this before `ARCHITECTURE.md`; that document describes the destination, this
one describes the road.

---

## Part 1 — What you are building, in plain terms

You built a weather workflow in n8n: a Schedule trigger, an HTTP Request to a weather API, an LLM
node, something to deliver the result. When you pressed **Execute**, n8n did exactly four things:

1. **Read a drawing.** Your canvas is stored as JSON — a list of boxes and a list of lines. That is
   all a workflow is.
2. **Found the starting box** and handed it an empty piece of data.
3. **Ran each box in order**, passing what came out of one into the next.
4. **Wrote down what happened**, so you could click a node afterwards and see its data.

That is the whole engine. "Workflow automation platform" sounds enormous; the core is *read some
JSON, loop over it, call some functions.* You are building the thing you have been using.

### The four parts

| Part | In plain terms | What it was in your n8n project |
|---|---|---|
| **Canvas** | A web page where you drag boxes and draw lines between them. Its only job is to produce JSON. | The n8n editor |
| **Graph** | That JSON — which boxes exist, each box's settings, which lines connect them | What n8n saved in its database |
| **Nodes** | Ordinary JavaScript functions: "given this input and these settings, call the Gmail API and return the result" | The node types in the palette |
| **Engine** | The loop that reads the JSON and calls those functions in the right order | What ran when you pressed Execute |

### Three ideas that make the rest obvious

**1. A node is just a function.**

```js
async function httpRequest(input, settings) {
  const res = await fetch(settings.url);
  return await res.json();
}
```

The icon, the sidebar form, the connectors — all decoration around a function with that shape. When
a node feels hard, you have stopped writing the function and started writing the decoration.

**2. The data flowing between nodes is an *array*, not a single object.**

Read 50 rows from a Sheet and the next node should handle all 50. So every node receives an array
and returns an array. n8n calls each element an **item**, and each item looks like:

```js
{ json: { name: "Alice", email: "a@example.com" } }
```

Files ride along in an optional `binary` key. Copy this model — it is the single decision that shapes
everything downstream, and it is very expensive to change in Week 9.

**3. You do not hand-write the settings form for each node.**

Every n8n node has a settings panel in the sidebar. Fifty nodes do not mean fifty hand-built forms.
Each node *declares* its settings as data:

```js
properties: [
  { displayName: 'URL',    name: 'url',    type: 'string',  default: '' },
  { displayName: 'Method', name: 'method', type: 'options', default: 'GET',
    options: [{ name: 'GET', value: 'GET' }, { name: 'POST', value: 'POST' }] },
]
```

…and **one** piece of React reads that list and renders the form. Build this once, in Week 6, and
adding a node afterwards is one file and no UI work. Skip it and every node costs a day of form
building, and only one person can work on the editor at a time.

### The order to build in

Beginners usually start with the canvas, because it is the visible part. That is backwards — you end
up with a beautiful drawing tool that cannot run anything, in Week 10.

Build the *inside* first:

```
1. An engine that runs a hard-coded workflow, as a plain script.   ← no web page at all
2. Two nodes chained together, passing items.
3. A database and a small web API around it.
4. The canvas, saving and loading that JSON.
5. The auto-generated settings form.
6. Expressions — {{ $json.city }}
7. Triggers — webhook, then schedule.
8. Credentials and the Google login dance.
9. The Google nodes, the Code node, the AI node.
10. Deploy, measure against n8n, write it up.
```

Each step is runnable. You are never more than a week from something you can show.

---

## Part 2 — The stages in detail

Fifteen stages mapped onto the schedule in `PLAN.md`. Each has a goal, the work, and a **done when**
that someone else on the team can verify.

### A note on the stack

`ARCHITECTURE.md` originally specified NestJS, Turborepo, `isolated-vm` and Terraform. Those are
good production choices and the wrong choices for this team — each is a second thing to learn on top
of the thing you are actually learning. The architecture is unchanged; the tools are simpler:

| Instead of | Use | Why |
|---|---|---|
| NestJS | **Express** | You can read all of Express in an afternoon. Decorators and dependency injection are a distraction from the engine, which is the interesting part |
| pnpm + Turborepo | **npm workspaces** | Built into npm. No extra tooling to learn or debug |
| BullMQ + Redis from day one | **Run executions in-process; add the queue in Stage 13** | The queue is a real improvement, but it is not what makes the project work. Add it when you understand why you want it |
| `isolated-vm` | **`node:vm` in a worker thread**, with the limitation documented | A native module that fails to build in Docker will eat three days. The weaker sandbox is fine when the only users are you — and explaining *why* it is weak is worth more marks than silently using the strong one |
| Terraform + ECS Fargate | **One EC2 instance running `docker compose`, with Caddy for HTTPS** | Same public webhook URL, roughly one afternoon instead of two weeks |

Keep: **TypeScript** (the node interface is the contract that stops eight people breaking each other,
and your editor will autocomplete it), **Postgres**, **React + React Flow**.

> Rule for TypeScript: nobody spends more than ten minutes fighting a type error. Write `as any`,
> leave a `// TODO: type this`, move on. TypeScript is there to help you, not to be satisfied.

---

### Stage 1 — The engine, as a plain script (Week 4)

**Goal:** prove to yourselves that the scary part is small. No web server, no database, no React.

Create `engine.js` and run it with `node engine.js`.

```js
// A workflow is nothing but this object.
const workflow = {
  nodes: [
    { name: 'Start',   type: 'manualTrigger', parameters: {} },
    { name: 'Weather', type: 'httpRequest',   parameters: { url: 'https://wttr.in/Newcastle?format=j1' } },
  ],
  // For each node: an array of output branches; each branch lists the nodes it feeds.
  connections: {
    'Start': [['Weather']],
  },
};

// A node type is a description plus a function.
const nodeTypes = {
  manualTrigger: {
    description: { name: 'manualTrigger', group: 'trigger', properties: [] },
    async execute() { return [[{ json: {} }]]; },
  },
  httpRequest: {
    description: { name: 'httpRequest', group: 'action', properties: [] },
    async execute(ctx) {
      const out = [];
      for (const item of ctx.getInputData()) {
        const res = await fetch(ctx.getNodeParameter('url'));
        out.push({ json: await res.json() });
      }
      return [out];
    },
  },
};

async function runWorkflow(workflow, nodeTypes) {
  const byName = Object.fromEntries(workflow.nodes.map(n => [n.name, n]));
  const results = {};

  const trigger = workflow.nodes.find(n => nodeTypes[n.type].description.group === 'trigger');
  const ready = [{ nodeName: trigger.name, items: [{ json: {} }] }];

  while (ready.length > 0) {
    const { nodeName, items } = ready.shift();
    const node = byName[nodeName];
    const type = nodeTypes[node.type];

    const ctx = {
      getInputData: () => items,
      getNodeParameter: (name) => node.parameters[name],
    };

    const branches = await type.execute(ctx);   // [[item, item], [item]]
    results[nodeName] = branches;
    console.log(nodeName, '->', JSON.stringify(branches).slice(0, 120));

    const targets = workflow.connections[nodeName] || [];
    branches.forEach((branchItems, i) => {
      if (branchItems.length === 0) return;               // nothing came out: prune this branch
      for (const target of targets[i] || []) {
        ready.push({ nodeName: target, items: branchItems });
      }
    });
  }
  return results;
}

runWorkflow(workflow, nodeTypes).then(() => console.log('done'));
```

Read the loop until every line makes sense. **That is the entire product.** Everything after this
stage is a database, a web page and a lot of API integrations wrapped around those forty lines.

**Known limitation, on purpose:** a node fed by two different branches will run twice. Merge nodes
need a node to *wait* for all its inputs. Leave it; write it down as a known issue and fix it in
Stage 13 if you get there. Shipping a limitation you have named is completely fine — pretending it
does not exist is not.

**Done when:** `node engine.js` prints real weather data, and all eight of you can explain the loop.

---

### Stage 2 — A real node interface and two more nodes (Week 5)

**Goal:** stop hard-coding and define the contract everyone will build against for ten weeks.

Create the workspace:

```bash
mkdir ai-automation && cd ai-automation && npm init -y
npm pkg set workspaces[0]="packages/*" workspaces[1]="apps/*"
mkdir -p packages/engine packages/nodes apps/api apps/editor
```

Move the engine into `packages/engine`, and give every node this shape (the full contract is in
`NODE-SPEC.md` — this is the short version):

```ts
export interface INode {
  description: {
    name: string;          // 'httpRequest' — never change this, it is stored in saved workflows
    displayName: string;   // 'HTTP Request'
    group: 'trigger' | 'action' | 'transform';
    inputs: string[];      // [] for triggers, ['main'] otherwise
    outputs: string[];     // ['main'], or ['main','main'] for IF
    credentials?: { name: string; required: boolean }[];
    properties: NodeProperty[];   // ← this is what draws the settings form
  };
  execute(ctx: IExecuteContext): Promise<INodeExecutionData[][]>;
}
```

Write **Set** (add fields to each item) and **IF** (two outputs) now, before any integration. IF is
the node that proves branching works, and Set is the node you will use in every test for the rest of
the project.

**Done when:** `Manual → Set → IF → (Set | Set)` runs and the correct branch fires.

---

### Stage 3 — Database and API (Week 5)

**Goal:** workflows survive a restart.

```bash
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    environment: { POSTGRES_PASSWORD: dev, POSTGRES_DB: automation }
    ports: ['5432:5432']
    volumes: ['pgdata:/var/lib/postgresql/data']
volumes: { pgdata: {} }
```

Two tables to start (full schema in `ARCHITECTURE.md`):

```sql
CREATE TABLE workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  nodes jsonb NOT NULL DEFAULT '[]',
  connections jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid REFERENCES workflows(id) ON DELETE CASCADE,
  status text NOT NULL,                 -- running | success | error
  data jsonb,                           -- what each node produced
  error jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
```

Storing the whole graph in two `jsonb` columns is deliberate — see `docs/adr/0001`. It is also what
n8n does.

An Express API with five routes is enough for weeks:

```js
import express from 'express';
const app = express();
app.use(express.json());

app.get('/rest/workflows',        async (req, res) => res.json(await listWorkflows()));
app.get('/rest/workflows/:id',    async (req, res) => res.json(await getWorkflow(req.params.id)));
app.post('/rest/workflows',       async (req, res) => res.json(await createWorkflow(req.body)));
app.patch('/rest/workflows/:id',  async (req, res) => res.json(await updateWorkflow(req.params.id, req.body)));
app.post('/rest/workflows/:id/run', async (req, res) => res.json(await runAndSave(req.params.id)));

app.listen(5678);
```

Use `pg` directly with SQL, not an ORM. You will write perhaps fifteen queries in the whole project,
and an ORM is another thing to learn.

**Done when:** you can POST a workflow, restart everything, GET it back, and POST `/run` to execute it.

---

### Stage 4 — The canvas (Week 5–6)

**Goal:** the drawing tool.

```bash
npm create vite@latest editor -- --template react-ts
npm install reactflow
```

**Do not build a canvas by hand.** React Flow gives you dragging, connecting, panning and zooming;
hand-rolling that is a semester on its own.

The only real work is translating between React Flow's shape and yours:

```ts
// yours -> React Flow
const rfNodes = workflow.nodes.map(n => ({
  id: n.name, position: n.position, type: 'workflowNode', data: { node: n },
}));

const rfEdges = Object.entries(workflow.connections).flatMap(([from, branches]) =>
  branches.flatMap((targets, branchIndex) =>
    targets.map(to => ({ id: `${from}:${branchIndex}->${to}`, source: from, target: to, sourceHandle: String(branchIndex) }))));
```

…and back again on save. Write that pair of functions carefully once; every canvas bug for the rest
of the project will be in them.

**Done when:** drag two nodes, connect them, refresh the page, and they are still there.

---

### Stage 5 — The generated settings panel (Week 6) ← the most important stage

**Goal:** adding a node requires zero editor work.

The API exposes every node's description:

```js
app.get('/rest/node-types', (req, res) => res.json(Object.values(nodeTypes).map(n => n.description)));
```

The editor renders a form from `properties`:

```tsx
function ParameterPanel({ properties, values, onChange }) {
  return properties.filter(p => isVisible(p, values)).map(p => {
    switch (p.type) {
      case 'string':  return <TextInput   key={p.name} label={p.displayName} value={values[p.name] ?? p.default} onChange={v => onChange(p.name, v)} />;
      case 'number':  return <NumberInput key={p.name} ... />;
      case 'boolean': return <Toggle      key={p.name} ... />;
      case 'options': return <Select      key={p.name} options={p.options} ... />;
      case 'json':    return <JsonEditor  key={p.name} ... />;
      default:        return null;
    }
  });
}

// displayOptions: { show: { operation: ['append'] } } — hide fields that do not apply
function isVisible(p, values) {
  const show = p.displayOptions?.show;
  if (!show) return true;
  return Object.entries(show).every(([field, allowed]) => allowed.includes(values[field]));
}
```

Roughly a hundred lines. It is what lets four people add nodes in parallel in Weeks 8–10 without
touching the editor, and it is the measurement that will make your n8n comparison interesting.

**Done when:** someone writes a new node file, restarts the API, and its complete settings form
appears in the sidebar without the editor being touched.

---

### Stage 6 — Expressions (Week 6)

**Goal:** `{{ $json.city }}` in a field, like n8n.

```js
export function resolve(value, item, allResults) {
  if (typeof value !== 'string' || !value.includes('{{')) return value;

  const whole = value.match(/^\{\{(.+)\}\}$/s);          // whole field is one expression
  const evaluate = (expr) => {
    const $json = item.json;
    const $node = new Proxy({}, { get: (_, name) => ({ json: allResults[name]?.[0]?.[0]?.json ?? {} }) });
    const $now  = new Date();
    return new Function('$json', '$node', '$now', `"use strict"; return (${expr});`)($json, $node, $now);
  };

  if (whole) return evaluate(whole[1]);                   // keep the real type: numbers stay numbers
  return value.replace(/\{\{(.+?)\}\}/gs, (_, expr) => String(evaluate(expr)));
}
```

Call it in `getNodeParameter` so nodes never see a raw template.

> **Say this in the report.** `new Function` is not a sandbox — an expression can reach anything the
> process can. It is acceptable here because the only person writing expressions is the workflow's
> own author, on a single-user system. Naming the limitation, and describing what a multi-tenant
> version would need, reads far better than pretending it is secure.

**Done when:** `HTTP Request` with URL `https://wttr.in/{{ $json.city }}?format=j1` works, fed by a
Set node.

---

### Stage 7 — The Webhook node (Week 7)

**Goal:** something outside your laptop can start a workflow.

The mechanism is small: when a workflow is activated, record its webhook path; when a request
arrives, look up the path and run the workflow with the request as the first item.

```js
app.all('/webhook/:path', async (req, res) => {
  const hook = await findWebhook(req.params.path, req.method);
  if (!hook) return res.status(404).json({ message: 'No workflow is listening on this path' });

  const trigger = [{ json: { headers: req.headers, query: req.query, body: req.body } }];

  if (hook.responseMode === 'immediately') {
    res.json({ message: 'Workflow was started' });
    runWorkflow(hook.workflowId, trigger).catch(console.error);   // do not await
    return;
  }
  const result = await runWorkflow(hook.workflowId, trigger);
  res.json(lastNodeOutput(result));
});
```

Two URLs per workflow, as in n8n: `/webhook-test/:path` while editing, `/webhook/:path` once
activated. Test it with `curl` or Postman; for a public URL during development use
`cloudflared tunnel --url http://localhost:5678`.

**Done when:** a POST from your phone runs a workflow on your laptop.

---

### Stage 8 — The Schedule trigger (Week 7)

**Goal:** workflows run on a clock.

```js
import { Cron } from 'croner';
const jobs = new Map();

export async function activate(workflow) {
  const node = workflow.nodes.find(n => n.type === 'scheduleTrigger');
  if (!node) return;
  jobs.set(workflow.id, new Cron(node.parameters.cronExpression,
    { timezone: node.parameters.timezone || 'Australia/Sydney' },
    () => runWorkflow(workflow.id, [{ json: { timestamp: new Date().toISOString() } }])));
}

export function deactivate(workflowId) {
  jobs.get(workflowId)?.stop();
  jobs.delete(workflowId);
}
```

Rebuild the registry on boot by loading every active workflow. Store an IANA timezone — never rely
on the server's local time, because the server will be in UTC and your demo is not.

**Done when:** a workflow set to `* * * * *` produces one execution row per minute, and stops when
deactivated.

---

### Stage 9 — Credentials and the Google login dance (Week 7–8)

This is where teams lose a week. The concept is five steps.

**What OAuth2 actually is:** you never see the user's Google password. Instead:

1. You send them to Google with your `client_id`, the `scope` list and your `redirect_uri`.
2. Google shows the consent screen. They approve.
3. Google redirects back to *your* server with `?code=...`.
4. Your server POSTs that code, plus your `client_secret`, to Google's token endpoint.
5. Google returns an **access token** (valid one hour) and a **refresh token** (long-lived). Store
   the refresh token, encrypted. When the access token expires, POST the refresh token for a new one.

```js
// Step 1 — where to send them
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: process.env.GOOGLE_CLIENT_ID,
  redirect_uri: `${BASE_URL}/rest/oauth2-credential/callback`,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/spreadsheets',
  access_type: 'offline',      // REQUIRED, or you get no refresh token
  prompt: 'consent',           // REQUIRED on re-authorization, or you get no refresh token
  state: credentialId,
});

// Steps 3-5 — the callback
app.get('/rest/oauth2-credential/callback', async (req, res) => {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: req.query.code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${BASE_URL}/rest/oauth2-credential/callback`,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await r.json();     // { access_token, refresh_token, expires_in }
  await saveCredentialData(req.query.state, tokens);
  res.send('<p>Connected. You can close this window.</p>');
});
```

Encrypt before storing — Node has this built in, no library needed:

```js
import crypto from 'node:crypto';
const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');   // 32 bytes

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return { data, iv, tag: c.getAuthTag() };
}

export function decrypt({ data, iv, tag }) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}
```

**Never** send decrypted credentials back to the browser, not even to their owner.

#### The two Google traps

1. **Gmail scopes are "restricted".** Publishing your OAuth app would need a verification and a
   security assessment you will not complete this semester. Stay in **External + Testing** mode and
   add every group member — *and your demonstrator's Google account* — as **Test Users**. Do this in
   Week 7, not the week you first need Gmail.
2. **In Testing mode, refresh tokens expire after seven days.** A credential you connected in Week 9
   is dead by the Week 14 demo, and it fails looking like a broken integration. **Re-connect every
   Google credential on the morning of the demo.** Make it step one of the runbook.

**Done when:** you click "Connect", approve on Google, and your server holds an encrypted refresh
token it can exchange for a working access token.

---

### Stage 10 — The Google nodes (Weeks 8–9)

Now that auth works, each node is just an HTTP call. Use the REST endpoints directly with `fetch`;
the `googleapis` npm package is large and hides exactly the thing your report needs to explain.

Write one shared helper and every node gets refresh-on-401 for free:

```js
async function googleRequest(credentialId, url, options = {}) {
  let token = await getAccessToken(credentialId);
  let res = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    token = await refreshAccessToken(credentialId);
    res = await fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`);
  return res.json();
}
```

The four calls that carry the demo:

```
Sheets append
  POST https://sheets.googleapis.com/v4/spreadsheets/{id}/values/{range}:append?valueInputOption=USER_ENTERED
  { "values": [["Alice", "a@example.com", "2026-09-04"]] }

Docs mail-merge  ← the best-looking Google demo, and the easiest
  POST https://docs.googleapis.com/v1/documents/{id}:batchUpdate
  { "requests": [ { "replaceAllText": {
      "containsText": { "text": "{{customer_name}}", "matchCase": true },
      "replaceText": "Alice" } } ] }

Drive upload
  POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart   (multipart body)

Gmail send
  POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send
  { "raw": "<the whole RFC-2822 message, base64url encoded>" }
```

Gmail is the fiddly one — you must build a MIME message yourself and base64url-encode it (standard
base64 with `+` → `-`, `/` → `_`, padding stripped). Budget a full day for Gmail and half a day each
for the others. Order them **Sheets → Docs → Drive → Gmail**, easiest first.

**Done when:** a webhook adds a row to a real spreadsheet, and a Docs template comes back filled in.

---

### Stage 11 — The Code node (Week 9)

**Goal:** users write JavaScript that runs inside a workflow.

```js
import { Worker } from 'node:worker_threads';

export function runUserCode(code, items, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const vm = require('node:vm');
      const { parentPort, workerData } = require('node:worker_threads');
      const sandbox = { items: workerData.items, console: { log(){} } };
      try {
        const result = vm.runInNewContext(workerData.code, vm.createContext(sandbox), { timeout: 2000 });
        parentPort.postMessage({ ok: true, result });
      } catch (e) {
        parentPort.postMessage({ ok: false, error: String(e) });
      }
    `, { eval: true, workerData: { code, items } });

    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Code node timed out')); }, timeoutMs);
    worker.on('message', (m) => { clearTimeout(timer); m.ok ? resolve(m.result) : reject(new Error(m.error)); });
    worker.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}
```

The worker thread is what makes the timeout real — `vm`'s own timeout cannot stop every runaway loop,
but terminating the thread can.

> **This is your best security section in the report, and it is free.** `node:vm` is *not* a security
> boundary. From inside it, `this.constructor.constructor('return process')()` reaches the host
> `process` object and escapes. Demonstrate that escape working, explain that a real platform needs a
> separate V8 isolate (`isolated-vm`) or a separate process, and state that you accepted the weaker
> boundary because the only users are the developers. That paragraph is worth more than quietly using
> the strong sandbox — it shows you understand the threat model rather than just the library.

Use Monaco (`@monaco-editor/react`) for the editing box — it is the editor from VS Code and takes
about ten lines.

**Done when:** a Code node can turn one item into ten, and an infinite loop is killed after 5 seconds
without taking down the server.

---

### Stage 12 — The AI node (Week 10)

This is what makes it an **AI** automation platform rather than an integration platform, so do not
let it slip into "if we have time". It is also one of the easiest nodes — a single HTTP call.

```js
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': credentials.apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: ctx.getNodeParameter('model', i),
    max_tokens: ctx.getNodeParameter('maxTokens', i),
    system: ctx.getNodeParameter('systemPrompt', i),
    messages: [{ role: 'user', content: ctx.getNodeParameter('userPrompt', i) }],
  }),
});
const data = await res.json();
return [[{ json: { text: data.content[0].text } }]];
```

Because `userPrompt` goes through the expression resolver, a user can write
`Classify this support email: {{ $json.body.message }}` in the sidebar — and that, feeding an IF
node, is the demo moment.

You ran a local LLM in your n8n weather project, so keep that option: point the node at an
OpenAI-compatible local endpoint (Ollama exposes one) as a second credential type. Being able to
switch between a hosted and a local model is a genuine feature and a good paragraph in the report.

**Done when:** an AI node classifies a webhook payload and an IF node routes on its answer.

---

### Stage 13 — Optional upgrades, only if ahead (Week 10)

In priority order: the execution queue (BullMQ + Redis, moving execution out of the API process);
proper multi-input handling so a Merge node can wait for both branches; per-node retry with backoff;
an AI Agent node that can call other nodes as tools.

The queue is the one to do if you only do one — it is the difference between "a web app that runs
workflows" and "a workflow platform", and it makes the architectural comparison with n8n's queue mode
a comparison of like with like.

---

### Stage 14 — Deploy (Week 11)

One EC2 instance (t3.small is enough), Docker and `docker compose`, and Caddy in front for automatic
HTTPS:

```
# Caddyfile — this is the entire TLS configuration
your-domain.com {
  reverse_proxy api:5678
}
```

Caddy obtains and renews the certificate itself. You need a domain name — a cheap `.xyz` is a few
dollars, or use a free DuckDNS subdomain.

Then: security group open on 80 and 443 only, `docker compose up -d`, and your webhook URL is public
and permanent. Set an AWS budget alarm at $50 on the first day.

**Done when:** the editor and a webhook URL work from a phone on mobile data, and survive a reboot.

---

### Stage 15 — Compare and write (Weeks 12–15)

Full method in `N8N-COMPARISON.md`. The short version:

- Run n8n in **queue mode** with Postgres and Redis on the same machine spec, with pinned image
  versions. Comparing your queue architecture to n8n's default single-process SQLite mode is not a
  fair test, and a marker will spot it.
- Build the same three workflows on both, run each three times, report medians, commit the raw CSVs.
- Run the extensibility experiment: the same person implements the same new node on both platforms,
  timed and counted in lines. You will win this one, and it is the measurement nobody else thinks to
  run.
- **Be honest.** n8n does more per execution, so a speed win is mostly "we do less". Saying that in
  the report is worth more marks than the win.
- n8n is under the **Sustainable Use Licence** — source-available, not OSI open source. Writing
  "n8n is open source" is a factual error.

Write the report weekly from Week 5, not in Week 15 — see `REPORT-OUTLINE.md`. Take screenshots as
you build; you cannot re-screenshot a torn-down server.

---

## Part 3 — Advice specific to a first project of this kind

**Build the boring version first, always.** The HTTP node that only does GET with no auth is more
valuable in Week 6 than the complete one in Week 9, because everything downstream can start.

**One person owns the engine.** It is the piece where two people editing at once produces a mess —
which is why A2 *reviews* it rather than co-writing it. The other six build against its interface.

**With eight people, sequence before you parallelise.** Weeks 4–6 have room for about three people of
real work on the critical path. The other five build on independent tracks that touch nobody else's
code: the panel generator against hand-written fake descriptions, the Google API calls proved by hand
in Postman, the canvas, the Google Cloud setup, and the repository plus CI. See `PLAN.md` §3 for the
per-person list. Everything converges at the Week 6 freeze, and from Week 8 six people build one node
each.

**Do not build authentication.** Users, logins, sessions, password resets — none of it earns a mark
here, and it will eat a week. One hard-coded user, or none.

**When a node does not work, check the raw HTTP call first.** Reproduce it in `curl` or Postman
outside your platform. Most "my node is broken" bugs are a wrong scope, a missing header or a
malformed body — nothing to do with your engine.

**Log the shape of your data constantly.** `console.log(JSON.stringify(items, null, 2))` between
nodes will explain more confusion than any debugger. The single most common bug in this project is
returning `[items]` where you meant `[[items]]`, or the reverse.

**Steal from n8n deliberately, and say so.** The item model, the properties-driven forms, the two
webhook URLs — these are good designs, and adopting them knowingly and citing them is exactly what
the assignment is asking for. Copying without understanding is the thing that costs marks; you avoid
that by being able to explain *why* each design is the way it is.
