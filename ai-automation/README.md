# AI Automation Platform

**ELEC 3111 · Group 2 · Semester Project**

An end-to-end automation platform in the shape of n8n: draw a workflow on a
canvas, and a server walks the drawing box by box — calling HTTP endpoints,
Google Workspace and a language model — while writing down exactly what
happened.

```
Webhook ──▶ AI ──▶ IF ──┬──▶ Gmail
                        └──▶ Google Sheets
```

## Five commands, ten minutes

```bash
git clone <this repository> && cd ai-automation
cp .env.example .env         # then put a real ENCRYPTION_KEY in it
npm install
docker compose up -d --wait  # Postgres 16
npm run seed                 # tables + the "Hello weather" example
npm run dev                  # editor 5173 · api 5678
```

Open <http://localhost:5173>, click **Hello weather**, press **Run**.

That whole list is once, ever. **After the first time it is one command:**

```bash
npm run dev
```

The database container restarts with Docker Desktop, so it is already waiting
for you. `docker compose down` stops it if you want it gone.

`npm run dev` runs `scripts/doctor.js` first. If anything is missing, the
doctor names the problem *and the exact command that fixes it* — a broken
start can never happen silently.

```
 ok  Node 22 or newer       v22.22.2
 ok  Dependencies installed
 ok  .env exists
 ok  ENCRYPTION_KEY is set
 ok  Postgres answers       postgres://postgres:****@localhost:5432/automation
 ok  Tables exist           workflows, executions, credentials, webhooks, schedules

Everything is ready.
```

Generate a real encryption key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## What is in here

| Folder | What it holds | Owner |
| --- | --- | --- |
| `apps/api/` | Express: the REST routes, webhooks, schedules, OAuth | C1 C2 |
| `apps/editor/` | React + React Flow + the parameter panel | B1 B2 |
| `packages/engine/` | The loop, items, expressions, errors, HTTP helper | A1 |
| `packages/nodes/core/` | IF, Set, Merge, Code, HTTP Request | A2 |
| `packages/nodes/google/` | Sheets, Drive, Docs, Gmail | D1 |
| `packages/nodes/ai/` | The LLM node | A1 |
| `benchmarks/` | k6 scripts, the n8n stack, raw results | D2 |
| `infra/` | Caddyfile, docker-compose.prod.yml, backup.sh | D2 |
| `scripts/` | `doctor.js` — the "why won't it start" answer machine | C1 |
| `docs/` | This guide, the ADRs, the report as it is written | D2 |
| `e2e/` | The browser test | B2 |

## Every command

| Command | What it does |
| --- | --- |
| `npm run dev` | Doctor, then the API (5678) and the editor (5173) |
| `npm run migrate` | Create the tables |
| `npm run seed` | Tables plus the starter workflow |
| `npm test` | Levels 1 and 2 — engine, nodes and API (needs Postgres) |
| `npm run e2e` | Level 3 — the browser test, which starts the app itself |
| `npm run coverage` | The same tests, with a coverage report |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript over the editor |
| `npm run build` | Production build of the editor |
| `npm run guide` | Rebuild the printable guide PDF from the source files |
| `npm run doctor` | "Why won't it start?" |

## The three ideas the whole thing rests on

1. **A workflow is text.** A list of boxes and a list of lines, in JSON. The
   canvas produces it, the database stores it in one column, the engine reads
   it. Nothing else is passed between them.
2. **A node is one file with two halves.** A description the screen turns into
   a settings form, and an `execute()` the engine calls. Neither half knows the
   other exists, which is why six people can add six nodes at once.
3. **Everything travels as a list of items.** `{ json: {...} }`, always an
   array, even when there is one. A node returns an array of *branches*, each
   an array of items — and an empty branch goes quiet, which is how the false
   side of an IF stops without any special case in the engine.

Full explanations, with diagrams, are in [`docs/guide.md`](docs/guide.md).

## Testing

| Level | What it catches | How long |
| --- | --- | --- |
| 1 · engine | Order, branch pruning, every guard | milliseconds |
| 2 · nodes and API | The right request; the five status codes | seconds |
| 3 · browser | Drag, connect, run, reload | about a minute |
| 4 · by hand | A real email; a real spreadsheet row | before every demo |

Levels 1–3 run on every push (`.github/workflows/ci.yml`). Level 4 is the
checklist in [`docs/demo-checklist.md`](docs/demo-checklist.md).

```bash
npm test     # 165 tests, about seven seconds, no internet needed
npm run e2e  # 2 browser tests, about seven seconds
```

## Security, honestly

- OAuth tokens are encrypted with **AES-256-GCM** and never sent to a browser.
- The webhook endpoint is the one address strangers can reach: it is rate
  limited, it verifies an optional HMAC signature in constant time, and it
  deduplicates retries by `Idempotency-Key`.
- Expressions run with `process`, `require` and `fetch` shadowed. **That is a
  speed bump, not a sandbox**, and the report says so.
- The Code node runs in a worker thread with a timeout *and* a memory limit.
  A determined attacker can still climb out of a `vm` context; a production
  platform would use `isolated-vm` or a container per execution. We can explain
  the limits of our own sandbox, which is worth more than quietly using a
  stronger one.

## Licence

Coursework for ELEC 3111. Not licensed for reuse.
