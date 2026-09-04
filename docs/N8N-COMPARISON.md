# Comparison with n8n

"Compare your application with n8n" is an explicit requirement of the brief, and it is the section
most likely to separate a good report from an average one. The average version is a feature table
where every row says "n8n has it, we do not". The good version **measures** something, explains an
architectural choice, and is honest about what a 10-week project can and cannot claim.

Three axes: **feature coverage** (§2), **architecture** (§3), **measured performance and
extensibility** (§4).

> **Verify before you publish.** Everything stated here about n8n's internals is a starting point, not
> a citation. Pin the exact version you benchmark (e.g. `n8nio/n8n:1.x.y`), check each claim against
> that version's source and docs, and cite it in the report. n8n moves fast — the Code node's
> isolation mechanism in particular has changed more than once.

---

## 1. Set-up

Run n8n self-hosted in **queue mode** — Postgres plus Redis plus separate worker processes — not the
default SQLite single-process mode. Our platform is a queue-mode architecture; benchmarking it
against n8n's simplest configuration would be a comparison of deployment topologies, and a marker
will notice.

```yaml
# benchmarks/n8n/docker-compose.yml  (sketch)
n8n-main:    { image: n8nio/n8n:PINNED, environment: [ EXECUTIONS_MODE=queue, DB_TYPE=postgresdb, ... ] }
n8n-worker:  { image: n8nio/n8n:PINNED, command: worker, deploy: { replicas: 2 } }
postgres:    { image: postgres:16 }
redis:       { image: redis:7 }
```

Both stacks get **identical CPU and memory limits** (`deploy.resources.limits`), the same Postgres and
Redis versions, and the same host — one EC2 instance, or one laptop with nothing else running. Record
the host spec, both image digests and the date in `benchmarks/README.md`.

---

## 2. Feature matrix

Fill honestly. "Partial" needs a footnote saying what is missing.

| Capability | n8n | Ours | Notes |
|---|---|---|---|
| Integration nodes | Several hundred (verify the count for your pinned version) | 13 core | The brief asked for the important ones, not all of them |
| Trigger types | Schedule, webhook, polling, app-specific, chat, form | Schedule, webhook, manual | |
| Expression language | `{{ }}` with a large built-in function library | `{{ }}` with `$json`, `$node`, `$now`, `$workflow` | Scope is the honest word here |
| Code node | JS and Python (Pyodide), isolated task runners | JS in `isolated-vm` | |
| AI / LLM nodes | LangChain-based agents, chains, vector stores, memory | LLM node (+ tool-calling agent if Tier 2 lands) | |
| Error handling | continueOnFail, retries, error workflows, error trigger | continueOnFail, retries | |
| Sub-workflows | Yes | No | Out of scope |
| Queue mode / horizontal scaling | Yes | Yes — separate api/worker/scheduler | Genuine parity, and worth saying so |
| Credential storage | Encrypted at rest, OAuth2 flows for most services | AES-256-GCM, Google OAuth2 + API key | |
| Binary data handling | Filesystem or S3 | S3 | |
| Workflow versioning / history | Yes | No (T2) | |
| Users, RBAC, SSO | Yes (some paid) | Single user | Deliberately out of scope |
| Community node ecosystem | Yes, npm-installable | No | |
| Observability | Execution list, logs, metrics endpoint | Execution list, logs | |
| **Licence** | **Sustainable Use Licence — "fair-code", not OSI open source** | Choose ours deliberately | See §5 |

---

## 3. Architectural comparison

Draw both architectures as diagrams and put them side by side. Points worth making:

**Convergent choices — say why, it shows judgement rather than imitation.** Both store the graph as
JSON rather than in relational tables; both pass an array of items between nodes rather than a single
object; both declare node parameters as data and generate the parameter UI from that declaration.
Each of these was chosen for a reason (§ ADR-001, ADR-002, `docs/NODE-SPEC.md` §1) — argue the reason,
not the resemblance.

**Divergent choices — the interesting part of the chapter:**

| Dimension | n8n | Ours | Argument |
|---|---|---|---|
| Process model | One `n8n` binary run in different roles (main / worker / webhook) via env vars | Three separately built services | Ours makes the boundary explicit and independently deployable; n8n's is simpler to operate and to ship as one image |
| Code isolation | External task-runner processes (after moving away from in-process `vm2`) | `isolated-vm` inside the worker | Theirs survives a runaway process; ours is simpler and has a smaller per-execution overhead |
| Editor | Vue | React + React Flow | No technical argument — say so plainly rather than inventing one |
| Front-end data flow | Bespoke canvas | React Flow does graph rendering, we own only node UI and state | A build-vs-buy trade with real consequences for how much of the 10 weeks went into the canvas |
| Node distribution | Community nodes installable from npm | Compiled into the image | Ours is a smaller attack surface and a worse ecosystem — that is the trade |

**The `vm2` story is worth a paragraph.** Sandboxing untrusted JavaScript in-process is genuinely
hard; `vm2` was widely used, then withdrawn after sandbox-escape vulnerabilities, and platforms that
depended on it had to move to stronger isolation. Explaining why we went straight to a V8-isolate
boundary, and demonstrating the `vm` escape from `docs/ARCHITECTURE.md` §3.4, connects our design to a
real incident in the ecosystem.

---

## 4. Measured comparison

### 4.1 The three workflows

Build each identically on both platforms and commit both JSON exports to `benchmarks/workflows/`.

| ID | Workflow | Measures |
|---|---|---|
| **W1** | Webhook → Set → Respond to Webhook | Per-execution overhead — the latency floor of the engine |
| **W2** | Schedule → HTTP (local mock API) → Code (transform) → Google Sheets append | A realistic integration path |
| **W3** | Webhook → Code (generate 1000 items) → IF → two branches | Item throughput and fan-out |

W2 hits a **local mock API**, not a real third-party service, so you are measuring the engines rather
than the internet. Keep one separate run against the real Google API to report as an illustration.

### 4.2 Metrics

| Metric | How |
|---|---|
| Latency p50 / p95 / p99 | `k6` against the webhook URL, 60 s, 10 VUs, 10 s warm-up discarded |
| Throughput (executions/s) | Sustained rate from the same run |
| Item throughput (W3) | Execution duration read from each platform's own database |
| Memory and CPU per worker | `docker stats` sampled at 1 Hz for the run window |
| Container image size | `docker images` |
| Cold start | Container start → first successful request |
| Activation latency | "Activate" → first webhook accepted |
| **LOC to add a node** | `cloc` on the diff for the *same* new node implemented on both |
| **Time to add a node** | Wall clock, same developer, same written spec, on both |

```js
// benchmarks/k6/w1.js
import http from 'k6/http';
export const options = {
  scenarios: { load: { executor: 'constant-vus', vus: 10, duration: '60s' } },
  thresholds: { http_req_duration: ['p(95)<1000'] },
};
export default function () {
  http.post(`${__ENV.TARGET}/webhook/bench-w1`, JSON.stringify({ id: __VU, ts: Date.now() }),
            { headers: { 'Content-Type': 'application/json' } });
}
```

Three runs minimum per workflow per platform; report **median and inter-quartile range**, never a
single run. Commit the raw CSVs — a marker who can see your raw data trusts your charts.

### 4.3 The extensibility experiment

This is the measurement most likely to favour us, and the one nobody else will think to run. Write a
specification for a small node (say, a "Slugify" transform, or a two-operation REST integration). Have
the *same* developer implement it on both platforms, from that spec, timed. Report lines of code,
files touched, and minutes.

Expect ours to win on both, because we have 13 nodes and no ecosystem to stay compatible with. **Say
that in the report.** A measured advantage with its cause explained is far more convincing than a
measured advantage presented as a triumph.

### 4.4 Reporting honestly

The single most valuable paragraph in this chapter is the one acknowledging the confounders:

- n8n does strictly more per execution — richer logging, data pinning, per-item lineage, community
  node loading, a larger UI surface. A latency win for us is largely **"we do less"**, not "we are
  better engineered".
- n8n is a mature product with years of production hardening; our platform has run for weeks, in one
  environment, on happy paths.
- We chose a benchmark that our architecture suits. State it.
- Sample sizes are small and the host is shared with an OS and a browser.

Then state what the comparison *does* legitimately support: that a focused implementation of the core
execution model can match a mature platform on the narrow paths it implements, that the item-based
data model and declarative node interface are sound designs independently arrived at, and that the
gap is overwhelmingly in **breadth** — integrations, ecosystem, operational maturity — rather than in
the engine.

---

## 5. Licensing

n8n is distributed under the **Sustainable Use Licence**, which the project describes as "fair-code":
the source is available and self-hosting is permitted, but there are restrictions on commercial
redistribution and hosting it as a service. It is *not* an OSI-approved open-source licence, and
saying "n8n is open source" in the report is a factual error a marker may well catch. Read the
current licence text yourself and cite it.

Then choose a licence for our repository deliberately — MIT is the sensible default for a university
project — and spend two sentences on why permissive licensing is or is not appropriate here. It shows
you understand that licence choice is an engineering and commercial decision, not boilerplate.
