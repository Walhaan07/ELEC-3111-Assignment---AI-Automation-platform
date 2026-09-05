# Project Plan — AI Automation Platform (ELEC 3111, Group 2)

**Brief:** Develop an AI automation platform similar to n8n, including the most important nodes
(Schedule trigger, Webhook, HTTP, Google APIs — Docs/Sheets/Drive/Gmail — Code node, etc.), and
compare the application with n8n.
**Deliverables:** Demo in Week 14 · Report in Week 15 — a step-by-step guide to implementing the
platform. (The brief's sentence about the cloud-platform report format belongs to a different
group's project and does not apply to us.)

**Decisions taken (see `docs/adr/`):** Node.js + TypeScript monorepo · Express API · React + React
Flow editor · Postgres · deployed with Docker Compose on a single EC2 instance · team of 8 ·
~10 weeks to demo.

> **New to this kind of project? Read [`BUILD-GUIDE.md`](BUILD-GUIDE.md) first.** It explains what a
> workflow engine actually is (a loop over some JSON), then walks through fifteen build stages with
> code. This plan is the schedule; that guide is the method. The toolchain there is deliberately
> lighter than a production team would choose — Express over NestJS, npm workspaces over Turborepo,
> Docker Compose on one instance over ECS and Terraform — because every tool you have to learn is a
> tool you are not spending on the engine.

| Document | Owner | What it covers |
|---|---|---|
| `docs/BUILD-GUIDE.md` | A1 | **Read first** — the concepts, then fifteen stages with code |
| `docs/PLAN.md` (this file) | Team lead | Scope, schedule, work split, risks, demo |
| `docs/ARCHITECTURE.md` | A1 | Services, data model, engine semantics, AWS topology |
| `docs/NODE-SPEC.md` | D1 | Node SDK contract and the node catalogue |
| `docs/N8N-COMPARISON.md` | D2 | Feature matrix and benchmark methodology |
| `docs/REPORT-OUTLINE.md` | D2 | Week 15 report structure |

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

## 3. Work split (8 people, 4 areas of 2)

Streams own **directories**, so merge conflicts are rare and ownership is unambiguous. Eight people
means four areas of two: inside a pair you swap work freely and review each other; across pairs you
talk through the three written agreements below.

| | Owns | Responsible for, all semester | Surge node |
|---|---|---|---|
| **A1 — Engine core** *(tech lead)* | `packages/engine` | The loop, item model, branch pruning, expression resolver. Writes Phase 1 alone. Casting vote on architecture | AI node |
| **A2 — Control flow & isolation** | `packages/nodes/core` | IF, Set, Merge, per-node retry and error handling; later the Code node's sandbox. Reviews A1 and vice versa | Code node |
| **B1 — Canvas** | `apps/editor/canvas` | React Flow, node rendering, and the conversion between its format and ours. Later the Monaco code box | — |
| **B2 — Sidebar & run viewer** | `apps/editor/panel` | The properties-panel generator (highest-leverage piece in the project), execution list and log viewer | Google Docs |
| **C1 — Server & database** | `apps/api` | REST API, schema and migrations, the query layer, auth stub | Google Drive |
| **C2 — Triggers & credentials** | `apps/api/triggers` | Webhook ingress, schedule registry, AES-256-GCM encryption, the Google OAuth2 flow and refresh | Gmail |
| **D1 — Integrations lead** | `packages/nodes/google` | The shared Google request helper and the node-writing conventions everyone copies. Ships Sheets first so the pattern exists before the surge | Google Sheets |
| **D2 — Infra, QA & report** | `infra/`, `.github/`, `docs/` | Docker, CI, deployment, benchmark harness, test strategy. Editor-in-chief of the report, director of the demo | test harness |

**The node surge (Weeks 8–10).** Node ownership is *temporary*. Once Phase 3 lands, nodes are
independent of the editor, so six people take one node each — the "surge node" column above. This is
the only reason eight people are an advantage rather than an overhead.

**Three written agreements, frozen and owned:**

| Agreement | Frozen | Owner | Breaks if changed |
|---|---|---|---|
| The `INode` shape | Phase 1 | A1 | every node |
| The REST API (five routes) | Phase 2 | C1 | the whole editor |
| The properties-description format | Phase 3 | B2 | every settings panel |

**Sequencing warning — the specific danger of being eight.** Phase 1 is genuinely one person's work
and Phase 2 is about three. Without a plan, five people spend Weeks 4–6 idle or, worse, rewriting the
core. The answer is eight *independent tracks* in Weeks 4–6, none of which reads another's code:

| | Weeks 4–6 track |
|---|---|
| A1 | The engine script — the critical path |
| A2 | Read it line by line, then write IF and Set against the agreed shape |
| B1 | A canvas that can drag and connect |
| B2 | The panel generator, built against **three hand-written fake descriptions** |
| C1 | Postgres, the schema, one working route |
| C2 | Google Cloud project and consent screen, then the OAuth round trip |
| D1 | **Prove all four Google calls by hand in Postman** and commit the exact requests |
| D2 | Repository, Compose, CI, AWS account, report skeleton |

They need exactly two Week-4 decisions in common: the node shape and the list of property types.

**Working rules for eight.** Directory owner reviews; one approval plus green CI merges — nobody waits
for eight. Pairs review each other (A1↔A2, B1↔B2, C1↔C2, D1↔D2). Monday planning runs as two
twenty-minute groups (engine + editor, then server + delivery); Thursday is forty minutes, all eight,
everyone demos something running. Never more than two people on one stuck problem. Write the
contribution statement weekly from the git history — with eight names it is a marked component and
cannot be reconstructed in Week 15.

**What eight buys.** Capacity in Weeks 8–10, and therefore scope: the AI Agent node, Merge,
per-node retry and the BullMQ queue move from Tier 2 "only if ahead" to **expected**.

---

## 4. Risk register

| Risk | L | I | Mitigation | Owner |
|---|---|---|---|---|
| **Google OAuth refresh tokens expire after 7 days while the app is in "Testing"** | High | Critical | Re-authorize every credential the morning of the demo; put it in the demo runbook as step 1; consider a service account for Sheets/Drive/Docs as a fallback path| C2 |
| Google OAuth consent screen / restricted Gmail scopes block access | High | Critical | Stay in External + Testing mode; add every group member **and the demonstrator's account** as Test Users by Week 7; never rely on app verification| C2 |
| Scope creep chasing n8n's node count | High | High | Tier 0/1/2; feature freeze end of Week 11 is enforced by the lead | A1 |
| Code-node sandbox: `isolated-vm` fails to build in the Fargate image | Med | High | Prototype `isolated-vm` inside the production Docker image by Week 6, not Week 9. Fallback: run the Code node in a separate short-lived worker process with no network and a hard timeout| A1 |
| Live-demo failure (network, API outage, quota) | Med | High | Pre-recorded fallback video by Week 13; local Docker Compose fallback on a second laptop; phone hotspot; a mock HTTP endpoint that never leaves the machine| D2 |
| AWS cost overrun / credits exhausted before Week 14 | Med | Med | Budget alarm at $50; `t4g.micro` single-AZ; scale services to zero outside working sessions; teardown script in `infra/`| D2 |
| Engine rewritten mid-project because the item model was wrong | Med | High | Adopt n8n's item model deliberately (ADR-002) in Week 5, freeze in Week 6| A1 |
| Benchmark comparison reads as unfair or naive | Med | Med | Identical hardware, 3+ runs, publish raw data, and state confounders explicitly — see `docs/N8N-COMPARISON.md`| D2 |
| A group member becomes unavailable | Med | Med | No solo-owned secrets; everything in the repo; pair on the critical path in Weeks 5–7 | A1 |

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

One task each — none of which needs anybody else's code to exist first.

| | Task | Blocks |
|---|---|---|
| **A1** | Write the engine script, walk all eight through it, then write the `INode` shape down and freeze it. Also ADR-001 and ADR-002 | everything |
| **A2** | Read A1's script line by line, then write IF and Set against the agreed shape. Nothing that calls an outside service | Phase 3 |
| **B1** | A React Flow canvas that can add a node and connect two nodes. Nothing needs to save yet | Phase 2 |
| **B2** | Agree the property types with A1, then build the panel generator against three hand-written fake descriptions | Phase 3 |
| **C1** | Postgres in Compose, first migration (`workflows`, `executions`, `credentials`), one working route | Phase 2 |
| **C2** | **Create the Google Cloud project**, enable the four APIs, configure the consent screen (External + Testing), add all eight of us *and the demonstrator* as Test Users | Phase 5 |
| **D1** | **Prove all four Google calls by hand in Postman** — append a row, `replaceAllText`, upload, send — and commit the exact requests | Phase 5 |
| **D2** | Repo structure and branch protection, `docker-compose.yml`, CI workflow, AWS account with a $50 budget alarm, report skeleton | Phases 2 and 6 |
| **All** | Read `BUILD-GUIDE.md` Part 1 before Monday; book the Week 13 rehearsal in everyone's calendar | — |

C2's and D1's tasks look like Week 8 work. They are here because Google's consent screen has waiting
periods we do not control and restricted scopes we cannot argue with — and because proving the four
API calls by hand now turns three weeks of research into three weeks of typing.

---

## 8. Assumptions

- Currently around Week 4, giving ~10 weeks to the demo. Shift the table in §2 if not.
- Eight people, in four pairs. With seven, D2 absorbs D1's Sheets work and the surge covers five nodes; with nine, split B2's generator and run-viewer work.
- Deploying to AWS is our own choice — it buys real public webhook URLs, a deployment chapter for
  the report, and a fair benchmark host. It is not required by the brief. If Week 11 gets tight,
  falling back to Docker Compose plus a Cloudflare tunnel costs few marks and de-risks the demo.
- The report has no prescribed external format, so §5 of `docs/REPORT-OUTLINE.md` (the step-by-step
  implementation guide) is where the marks concentrate.
