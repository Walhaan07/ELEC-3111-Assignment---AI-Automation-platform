# Project Plan — AI Automation Platform (ELEC 3111, Group 2)

**Brief:** Develop an AI automation platform similar to n8n, including the most important nodes
(Schedule trigger, Webhook, HTTP, Google APIs — Docs/Sheets/Drive/Gmail — Code node, etc.), and
compare the application with n8n.
**Deliverables:** Demo in Week 14 · Report in Week 15 — a step-by-step guide to implementing the
platform. (The brief's sentence about the cloud-platform report format belongs to a different
group's project and does not apply to us.)

**Decisions taken (see `docs/adr/`):** Node.js + TypeScript monorepo · React + React Flow editor ·
Postgres + Redis · deployed on AWS ECS Fargate · team of 5+ · ~10 weeks to demo.

| Document | Owner | What it covers |
|---|---|---|
| `docs/PLAN.md` (this file) | Team lead | Scope, schedule, work split, risks, demo |
| `docs/ARCHITECTURE.md` | Stream A | Services, data model, engine semantics, AWS topology |
| `docs/NODE-SPEC.md` | Stream D | Node SDK contract and the node catalogue |
| `docs/N8N-COMPARISON.md` | Stream E | Feature matrix and benchmark methodology |
| `docs/REPORT-OUTLINE.md` | Stream E | Week 15 report structure |

---

## 1. Scope

The trap in this assignment is chasing n8n's ~400 nodes. Marks come from a **working engine, a
credible node SDK, real Google integrations, and an honest comparison** — not node count. Scope is
therefore tiered, and Tier 2 is explicitly allowed to be dropped.

### Tier 0 — Walking skeleton (must exist end of Week 5)
Manual Trigger → Set → HTTP Request, drawn in the editor, executed by the engine, persisted as an
execution record, result visible in the UI. Everything else is built against this spine.

### Tier 1 — Graded core (must exist end of Week 11, then feature freeze)
| # | Node | Why it is in scope |
|---|---|---|
| 1 | Manual Trigger | Development and demo ergonomics |
| 2 | **Schedule Trigger** | Named in the brief |
| 3 | **Webhook** | Named in the brief |
| 4 | **HTTP Request** | Named in the brief; the workhorse node |
| 5 | **Code** | Named in the brief; the sandbox is a report highlight |
| 6 | **Google Sheets** | Named in the brief |
| 7 | **Google Drive** | Named in the brief |
| 8 | **Google Docs** | Named in the brief |
| 9 | **Gmail** | Named in the brief |
| 10 | IF | Without branching the engine is a pipeline, not a workflow engine |
| 11 | Set / Edit Fields | Required to shape data between integrations |
| 12 | Respond to Webhook | Makes the Webhook node genuinely useful |
| 13 | **AI / LLM node** | This is what makes it an *AI* automation platform, not just an automation platform |

### Tier 2 — Stretch, in this order
Merge · Wait · retry-with-backoff per node · Error Trigger and error workflows · Execute Workflow
(sub-workflows) · pinned test data · workflow versioning · **AI Agent node with tool calling**
(highest marks-per-hour of anything in Tier 2 — it is the clearest differentiator from a plain
integration platform).

### Explicitly out of scope
Multi-tenancy and RBAC · a community node marketplace · a public template gallery · SSO ·
horizontal auto-scaling policies · anything requiring Google OAuth app verification.

---

## 2. Schedule

Weeks are course weeks, anchored on the Week 14 demo. Adjust the offset if your current week is not
Week 4. Each week has a **gate** — a demonstrable state, not a task list. A missed gate means cutting
scope that week, not absorbing the slip.

| Week | Theme | Gate (demonstrable) |
|---|---|---|
| **4** | Foundations | `docker compose up` gives API `/health`, empty editor canvas, migrated DB. CI green on a PR. |
| **5** | **Walking skeleton** | Manual → Set → HTTP runs end to end; execution persisted; result visible in the editor. **Non-negotiable.** |
| **6** | Node SDK + generated UI | A brand-new node appears in the palette with a working parameters form and **zero editor code written**. `INode` and the REST API are frozen. |
| **7** | Triggers + credentials | A Postman request fires a live workflow; a cron fires every minute; credentials stored encrypted. **Google Cloud OAuth consent screen configured with all test users — hard deadline.** |
| **8** | Google I | Webhook → Google Sheets append writes a row into a real spreadsheet. Drive upload/download working with binary data. |
| **9** | Google II + Code | Sheets row → Google Docs template fill → Drive → Gmail send, with attachment. Code node running in a real sandbox with the Monaco editor. |
| **10** | Control flow + AI | Full demo workflow green, including an IF branch, an error-and-retry path, and the AI node. Execution list and log viewer usable. |
| **11** | **Feature freeze** + AWS | Public HTTPS editor URL and public webhook endpoint on AWS, stable for 24 h. After this week: bugs, tests, benchmarks and writing only. |
| **12** | Benchmarks + hardening | n8n instance running; k6 harness; 3 workflows × 2 platforms × 3 runs; raw data and charts committed. Security pass done. |
| **13** | Report draft + rehearsal | Complete report draft circulated. Demo rehearsed twice, under 10 minutes. **Fallback video recorded.** |
| **14** | **DEMO** | Re-consent Google OAuth that morning. Demo. Write down every piece of feedback. |
| **15** | **REPORT** | Feedback incorporated, appendices complete, submitted. |

**Weekly cadence:** Monday 30 min planning (assign the week's gate), Thursday 30 min integration —
everyone demos what actually runs on `main`. One approval plus green CI merges a PR; no direct
pushes to `main`.

---

## 3. Work split (5 streams)

Streams own directories, so merge conflicts are rare and ownership is unambiguous.

| Stream | Owns | Responsibilities |
|---|---|---|
| **A — Engine & core** (tech lead) | `packages/engine` | Execution engine, item model, branch pruning, expression resolver, queue integration, cancellation, error and retry semantics |
| **B — Editor** | `apps/editor` | React Flow canvas, properties panel generator, execution log viewer, credential UI, Monaco Code editor |
| **C — Platform & triggers** | `apps/api`, `apps/scheduler` | REST API, auth, webhook ingress, scheduler, credential encryption, Google OAuth2 flow and token refresh |
| **D — Integrations** | `packages/nodes` | HTTP node, four Google nodes, AI node, credential type definitions. **With 6 people split this: D1 = Sheets + Drive, D2 = Gmail + Docs + AI** |
| **E — Infra, QA & report** | `infra/`, `.github/`, `docs/` | Docker, Terraform, CI/CD, test strategy, benchmark harness, report editor-in-chief, demo director |

**Contracts between streams (frozen Week 6, changed only by ADR):**
- A ↔ D: the `INode` interface in `packages/nodes-sdk`
- B ↔ C: the OpenAPI description of the REST API
- Everyone ↔ E: `docker-compose.yml`

**Sequencing warning.** Do *not* put five people on nodes in Week 5. Until the skeleton exists there
is nothing to build against, and parallel work on an unstable core produces five rewrites. Weeks 4–5
are A and C building the spine while B builds the canvas, D writes node *specs* (not code) and
prototypes the Google OAuth click-path, and E stands up CI and Compose. Real parallelism starts in
Week 6 when the SDK is frozen.

---

## 4. Risk register

| Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|
| **Google OAuth refresh tokens expire after 7 days while the app is in "Testing"** | High | Critical | Re-authorize every credential the morning of the demo; put it in the demo runbook as step 1; consider a service account for Sheets/Drive/Docs as a fallback path | C |
| Google OAuth consent screen / restricted Gmail scopes block access | High | Critical | Stay in External + Testing mode; add every group member **and the demonstrator's account** as Test Users by Week 7; never rely on app verification | C |
| Scope creep chasing n8n's node count | High | High | Tier 0/1/2; feature freeze end of Week 11 is enforced by the lead | Lead |
| Code-node sandbox: `isolated-vm` fails to build in the Fargate image | Med | High | Prototype `isolated-vm` inside the production Docker image by Week 6, not Week 9. Fallback: run the Code node in a separate short-lived worker process with no network and a hard timeout | A |
| Live-demo failure (network, API outage, quota) | Med | High | Pre-recorded fallback video by Week 13; local Docker Compose fallback on a second laptop; phone hotspot; a mock HTTP endpoint that never leaves the machine | E |
| AWS cost overrun / credits exhausted before Week 14 | Med | Med | Budget alarm at $50; `t4g.micro` single-AZ; scale services to zero outside working sessions; teardown script in `infra/` | E |
| Engine rewritten mid-project because the item model was wrong | Med | High | Adopt n8n's item model deliberately (ADR-002) in Week 5, freeze in Week 6 | A |
| Benchmark comparison reads as unfair or naive | Med | Med | Identical hardware, 3+ runs, publish raw data, and state confounders explicitly — see `docs/N8N-COMPARISON.md` | E |
| A group member becomes unavailable | Med | Med | No solo-owned secrets; everything in the repo; pair on the critical path in Weeks 5–7 | Lead |

---

## 5. Demo plan (Week 14, ~10 minutes)

| Time | Beat |
|---|---|
| 0:00 | Problem and one architecture slide. What we built, in one sentence. |
| 1:00 | Editor tour — palette, drag Webhook → Code → IF → {Sheets, Gmail}, show the auto-generated properties panel |
| 2:30 | "Listen for test event", fire a request from Postman, watch live data land on the canvas, open the per-node output inspector |
| 4:00 | Activate the workflow, hit the **production** webhook from a phone, a row appears in a real Google Sheet and a real email arrives |
| 5:30 | Schedule trigger firing on a cron; execution list with green and red runs; open a failed run, show the error and the retry |
| 6:30 | AI node classifying the incoming payload and routing the IF branch — the "AI" in AI automation platform |
| 7:30 | **Extensibility showcase:** write a brand-new node live in ~90 seconds; it appears in the palette with a complete form. This is the strongest argument in the whole demo |
| 9:00 | One benchmark slide: our numbers next to n8n's, with the honest caveat |
| 9:45 | Q&A |

Rehearse twice in Week 13 and once on the morning of Week 14. Record the fallback video in Week 13
while everything still works.

---

## 6. Definition of done

- CI runs typecheck, lint, unit tests and an image build on every PR.
- Every node ships with: one unit test (parameters → mocked API call), one integration test against a
  mock server, and an entry in the node catalogue in `docs/NODE-SPEC.md`.
- No secrets in the repository; `gitleaks` runs in CI.
- Every significant decision has an ADR in `docs/adr/NNN-title.md`.
- **Screenshot as you build.** The report needs images of the Google Cloud console, the AWS console
  and the editor. You cannot re-screenshot a stack you have already torn down.

---

## 7. Do this week

1. Create the GitHub repo structure and the pnpm workspace; protect `main`. — E
2. `docker-compose.yml` with Postgres and Redis; API `/health`; CI workflow. — E, C
3. Write ADR-001 (workflow stored as JSONB) and ADR-002 (adopt the n8n item model). — A
4. First migration: `workflows`, `executions`, `credentials`. — C
5. React Flow canvas that can add a node, connect two nodes, and save to the API. — B
6. **Create the Google Cloud project, enable the Sheets/Drive/Docs/Gmail APIs, configure the OAuth
   consent screen (External + Testing), add every group member as a Test User.** Do it now, not in
   Week 8 — this is the single most common cause of a failed demo in this kind of project. — D
7. Get an AWS account with credits and set the $50 budget alarm. — E
8. Book the Week 13 rehearsal slot in everyone's calendar. — Lead

---

## 8. Assumptions

- Currently around Week 4, giving ~10 weeks to the demo. Shift the table in §2 if not.
- Six people would split stream D; five means D is a single owner and E carries infra plus report.
- Deploying to AWS is our own choice — it buys real public webhook URLs, a deployment chapter for
  the report, and a fair benchmark host. It is not required by the brief. If Week 11 gets tight,
  falling back to Docker Compose plus a Cloudflare tunnel costs few marks and de-risks the demo.
- The report has no prescribed external format, so §5 of `docs/REPORT-OUTLINE.md` (the step-by-step
  implementation guide) is where the marks concentrate.
