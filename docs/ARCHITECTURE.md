# Architecture

Target stack: Node.js 22 + TypeScript everywhere, Express, Postgres 16, React 18 + React Flow,
deployed as containers with Docker Compose on a single EC2 instance. Redis and BullMQ arrive as a
deliberate upgrade once the engine works, not on day one.

> **This document describes the destination.** For how to get there — and why the toolchain is
> deliberately lighter than a production team would pick — read [`BUILD-GUIDE.md`](BUILD-GUIDE.md)
> first. Until Stage 13 of that guide, the api, worker and scheduler below all run inside one
> process; the split is a refactor you do once you can feel why you want it, not a starting shape.

---

## 1. Services

Four deployables. The split mirrors n8n's queue mode, which makes the architectural comparison in the
report concrete rather than hand-waved.

| Service | Responsibility | Scale |
|---|---|---|
| **api** | REST API, auth, webhook ingress, OAuth2 callback, SSE stream of live execution events to the editor | 2 tasks |
| **worker** | Consumes the execution queue, runs the engine, executes nodes, runs the Code node sandbox | 2 tasks |
| **scheduler** | Evaluates cron schedules, enqueues executions | **exactly 1 task** |
| **editor** | React SPA (static build) | CloudFront + S3 |

Backing services: Postgres (workflow, credential and execution state), Redis (BullMQ queue,
distributed locks, live-execution pub/sub), S3 (binary data — attachments and downloaded files).

**Why the API never executes a workflow.** A long HTTP request, a Code node in an infinite loop, or a
Google API timeout must not be able to take down the request path that serves webhooks. Everything
that runs user data runs in `worker`.

```
                 ┌────────────┐
  browser ──────▶│ CloudFront │──▶ S3 (editor SPA)
                 └────────────┘
                 ┌────────────┐      ┌──────────────┐
  webhook ──────▶│    ALB     │─────▶│     api      │──┐
  caller         └────────────┘      └──────────────┘  │ enqueue
                                            │  ▲       ▼
                                       SSE  │  │   ┌────────┐
                                            ▼  │   │ Redis  │◀── locks ──┐
                                       (editor)│   │ BullMQ │            │
                                               │   └────────┘            │
                                               │       │ consume         │
                        ┌──────────────┐       │       ▼            ┌──────────┐
                        │  Postgres    │◀──────┴──┬─────────────────│ scheduler│
                        │ (RDS)        │          │                 └──────────┘
                        └──────────────┘   ┌──────────────┐
                                           │    worker    │──▶ Google APIs, HTTP, Anthropic
                                           └──────────────┘──▶ S3 (binary)
```

---

## 2. Data model

```sql
users(id uuid pk, email text unique, password_hash text, created_at timestamptz)

workflows(id uuid pk, owner_id uuid fk, name text, active bool default false,
          nodes jsonb, connections jsonb, settings jsonb,
          version int default 1, created_at, updated_at)

credentials(id uuid pk, owner_id uuid fk, name text, type text,
            data_ciphertext bytea, iv bytea, auth_tag bytea, created_at, updated_at)

executions(id uuid pk, workflow_id uuid fk, mode text,          -- manual | trigger | webhook
           status text,                                          -- new|running|success|error|canceled
           trigger_node text, started_at, finished_at, error jsonb)

execution_node_runs(id uuid pk, execution_id uuid fk, node_name text, status text,
                    started_at, finished_at, items_in int, items_out int,
                    output_data jsonb, error jsonb)

webhooks(path text, method text, workflow_id uuid fk, node_name text, is_test bool,
         primary key (path, method))

schedules(id uuid pk, workflow_id uuid fk, node_name text, cron text,
          timezone text, next_run_at timestamptz, active bool)
```

**ADR-001 — the graph lives in one JSONB column.** `workflows.nodes` and `workflows.connections`
hold the whole canvas. This is what n8n does. It makes load and save a single row operation and
versioning trivial (copy the row). The cost is that you cannot ask SQL "which workflows use the Gmail
node" without a JSONB scan. That trade is right at this scale and is worth a paragraph in the report.

**Retention.** `execution_node_runs.output_data` grows fast. Truncate any single node output over
~64 KB with a `{"__truncated": true}` marker, and add a nightly job deleting executions older than 7
days. Do this in Week 10, not after the disk fills during the Week 12 benchmark.

---

## 3. Execution model

### 3.1 Items

**ADR-002 — adopt n8n's item model.** Every node receives an array of items and returns an array of
output branches, each an array of items:

```ts
interface INodeExecutionData {
  json: Record<string, unknown>;
  binary?: Record<string, { data: string; mimeType: string; fileName?: string }>;
}

type NodeOutput = INodeExecutionData[][];   // [branchIndex][itemIndex]
```

A node runs **once**, receiving all its input items, and loops internally. `IF` returns
`[trueItems, falseItems]`. Most nodes return `[items]`.

Two consequences worth understanding before writing the engine: a node that emits zero items prunes
everything downstream of it, and "run once per item" behaviour (the Code node's per-item mode, or an
HTTP call per row) is a loop *inside* the node, not a loop in the engine.

Adopting this model deliberately means the report can compare like with like, and means anyone on the
team who has used n8n already has the right mental model.

### 3.2 The engine

```
load workflow ─▶ build graph ─▶ seed ready-queue with the trigger node
                                   │
        ┌──────────────────────────┘
        ▼
   pop node whose inputs are all resolved
        │
        ├─ resolve parameters (expression evaluation against $json / $node / $now)
        ├─ load + decrypt credentials
        ├─ run node.execute(ctx)  ── error ─▶ continueOnFail? ─▶ retryOnFail (maxTries, backoff)
        ├─ persist execution_node_runs row + publish SSE event
        └─ push downstream nodes whose branch received ≥ 1 item
        │
        ▼  (repeat until ready-queue empty)
   mark execution success | error
```

Not a plain topological sort: branch pruning means a node's readiness depends on whether its incoming
branch actually produced items. Cycles are rejected at save time.

**Cancellation:** the worker checks a Redis key `cancel:<executionId>` between nodes.
**Concurrency:** BullMQ worker concurrency of 5 per task, tuned in Week 12.

### 3.3 Expressions

Support the n8n-style subset:

```
{{ $json.email }}
{{ $node["Webhook"].json.body.orderId }}
{{ $now }}   {{ $itemIndex }}   {{ $workflow.name }}
```

Any string parameter containing `{{ }}` is resolved per item before `execute()` is called, so nodes
never see raw templates. **Evaluate expressions in the same isolate mechanism as the Code node** —
one sandbox to build, one to explain, one to attack in the security section. Budget 50 ms per
expression.

### 3.4 Code node sandbox

**Start with `node:vm` inside a `worker_thread`**, with a 5 s timeout enforced by terminating the
thread. No native modules, nothing to fail in a Docker build, about forty lines — see BUILD-GUIDE
Stage 11. `isolated-vm` (a true V8 isolate with its own heap and memory cap) is the upgrade, worth
taking only once everything else works.

> **This is a report highlight, and the weaker sandbox makes it better rather than worse.** Node's
> built-in `vm` module is *not* a security boundary — `this.constructor.constructor('return
> process')()` reaches the host `process` through a leaked constructor and escapes. Demonstrate that
> escape working, explain that a real platform needs a separate isolate or a separate process, and
> state that the weaker boundary was accepted because the only users are the developers. Naming your
> threat model earns more than silently importing a stronger library would.

---

## 4. Triggers

### 4.1 Webhook

- Production: `POST|GET|... /webhook/:path` · Test: `/webhook-test/:path`
- Activating a workflow inserts a `webhooks` row; deactivating deletes it.
- `api` resolves path + method → enqueues an execution carrying `{ headers, params, query, body }`.
- Response modes: `immediately` (202 and an ack), `lastNode` (wait for the run, return the final
  node's output), `responseNode` (the Respond to Webhook node decides). The waiting modes park the
  HTTP response and resume it from a Redis pub/sub message published by the worker.
- Test URLs stream into the editor over SSE, giving the "Listen for test event" experience. It is
  cheap to build once SSE exists and it is the best-looking 30 seconds of the demo.

### 4.2 Schedule

`scheduler` keeps an in-memory registry (`croner`), rebuilt on boot and on activation events
received over Redis pub/sub. Store an IANA timezone per schedule; do not use server local time.

Run **one** scheduler task, and still take a Redis lock before enqueuing:

```
SET lock:schedule:<scheduleId>:<minuteBucket> 1 NX PX 55000
```

ECS will occasionally run two tasks during a deployment. Without the lock, every deploy double-fires
every cron — a bug that is invisible in development and obvious in a demo.

---

## 5. Credentials and Google OAuth2

Credential types are declared like nodes (name, display name, properties, an `authenticate` hook and
a `test` hook), so the editor renders their forms from the same generator as node parameters.

**Encryption:** AES-256-GCM. Key from AWS Secrets Manager in the cloud, `ENCRYPTION_KEY` in Compose
locally. Store ciphertext, IV and auth tag in separate columns. Decryption happens **only** in the
worker. The API returns credentials to the editor with every secret field replaced by a sentinel —
never the plaintext, not even to the owner.

**Google setup (one project, one OAuth client):**

| Node | Scope |
|---|---|
| Sheets | `https://www.googleapis.com/auth/spreadsheets` |
| Drive | `https://www.googleapis.com/auth/drive.file` (prefer over full `drive`) |
| Docs | `https://www.googleapis.com/auth/documents` |
| Gmail | `https://www.googleapis.com/auth/gmail.send`, `.../gmail.modify` |

Redirect URI: `https://<your-domain>/rest/oauth2-credential/callback`. Store the refresh token; on a
401, refresh once and retry the request before surfacing an error.

> **Two traps that end demos.** (1) Gmail scopes are *restricted* — a production, verified app needs a
> security assessment you will not complete this semester. Stay in **External + Testing** mode and add
> every group member and the demonstrator as **Test Users**. (2) In Testing mode **refresh tokens
> expire after 7 days**. A credential authorized in Week 9 is dead by Week 14. Re-authorize every
> Google credential on the morning of the demo — make it step 1 of the runbook.

---

## 6. Repository layout

```
apps/
  api/          Express — REST, webhook ingress, OAuth callback, SSE
  worker/       BullMQ consumer hosting the engine
  scheduler/    cron registry
  editor/       React + React Flow + Monaco
packages/
  engine/       graph execution, expression resolver, sandbox
  nodes-sdk/    INode, INodeExecutionData, contexts, property types  ← frozen Week 6
  nodes/        one directory per node + credential type definitions
  shared/       zod schemas shared by API and editor
infra/
  terraform/    VPC, ECS, RDS, ElastiCache, ALB, CloudFront, ECR, Secrets Manager
  docker/       Dockerfiles
benchmarks/     k6 scripts, workflow JSON for both platforms, raw results, chart scripts
docs/           plan, architecture, node spec, comparison, report source, ADRs
```

**npm workspaces** — built into npm, no extra tooling. One `docker-compose.yml` at the root brings up
Postgres, the API and the editor dev server; Redis joins it at Stage 13.

---

## 7. AWS deployment

| Concern | Choice |
|---|---|
| Compute | **One EC2 instance (t3.small), running `docker compose up -d`** |
| Ingress | **Caddy** in front of the API — it obtains and renews the TLS certificate itself |
| DNS | A cheap domain, or a free DuckDNS subdomain |
| Database | Postgres in a container on the same instance, on a named volume |
| Binary data | The instance's disk to start; S3 only if binary handling grows |
| Secrets | An `.env` file on the instance, outside the repository |
| Logs | `docker compose logs`, plus a `logs/` bind mount |
| Deploy | `git pull && docker compose up -d --build` over SSH |

Rough cost: **USD 15–20/month**, and the whole thing stops with `docker compose down`. Set a $50
budget alarm on day one.

**The production version, if you get there:** ECS Fargate for `api`/`worker`/`scheduler`, an ALB with
ACM, RDS, ElastiCache, S3 and CloudFront for the editor, all in Terraform. Around USD 60–90/month.
This is a genuine stretch goal — it is roughly two weeks of learning, it earns few marks the single
instance does not, and it competes directly with Weeks 12–13, which you cannot afford to lose.
Describe it in the report's future-work section instead, unless you are comfortably ahead.

---

## 8. Testing

| Layer | Tool | What |
|---|---|---|
| Unit | Vitest | Expression resolver, engine branch pruning, each node's parameter → request mapping |
| Integration | Vitest + `msw` / a local mock server | Each node against a mocked Google/HTTP endpoint, including the 401-refresh-retry path |
| End-to-end | Playwright | Build a workflow in the editor, execute it, assert the result renders |
| Load | k6 | The Week 12 benchmark harness, reused as a regression check |
| Security | Manual + CI | `vm` escape attempts against the Code node, SSRF against the HTTP node (block link-local `169.254.169.254` — the EC2 metadata endpoint), credential redaction in logs |

The SSRF block on the HTTP node is worth calling out in the report: a workflow platform that will make
an arbitrary HTTP request on behalf of a user is, by design, a confused deputy sitting inside your VPC.
