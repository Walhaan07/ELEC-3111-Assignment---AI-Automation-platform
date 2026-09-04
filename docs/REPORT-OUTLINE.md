# Report Outline (Week 15)

The brief asks for **"a step by step guide on how to implement the Automation platform."** That is a
specific genre: a reader who has our report and an empty machine should be able to rebuild the
platform. It is not a narrative of what the group did, and it is not an essay about workflow
automation. Section 5 is where the marks are — give it half the page count.

*(The brief's note about the cloud-platform report format concerns a different group's project and
does not constrain us.)*

**Write it weekly, not in Week 15.** Each stream adds to its section in the week it builds the thing.
`docs/` is the report's source. The Week 15 job is editing, the comparison chapter and the
appendices — not first drafting.

---

## Structure

| § | Section | Pages | Owner | Written by |
|---|---|---|---|---|
| 1 | Introduction | 2 | Lead | W13 |
| 2 | Background and related work | 3 | E | W12 |
| 3 | Requirements | 3 | Lead | W6 |
| 4 | System architecture | 6 | A | W7, revised W11 |
| 5 | **Implementation — step by step** | **18–22** | all streams | **weekly, W5–W11** |
| 6 | Deployment | 5 | E | W11 |
| 7 | Testing and validation | 4 | E | W12 |
| 8 | Comparison with n8n | 7 | E + Lead | W12–W13 |
| 9 | Discussion and limitations | 3 | Lead | W13 |
| 10 | Conclusion | 1 | Lead | W14 |
| — | References, appendices | — | E | W15 |

---

### 1. Introduction
Problem: business processes glued together by hand. What n8n is and why a workflow automation
platform is a useful thing to build. Objectives, in the words of the brief. Scope, with the Tier 0/1/2
table and the explicit exclusions. A one-paragraph summary of what was achieved. Report roadmap.

### 2. Background and related work
Workflow automation and iPaaS. Compare n8n, Zapier, Make and Node-RED across hosting model, extension
model, pricing and licence. Directed-acyclic-graph execution as the shared underlying model. Sandboxing
untrusted code as a recurring problem in this class of system. Cite properly — this is the section
where a marker looks for real references rather than blog posts.

### 3. Requirements
Functional requirements numbered FR-01… (one per node plus engine capabilities), each traceable to a
test in §7. Non-functional: performance targets, security (credential encryption, sandboxing, SSRF),
extensibility (a node added without editor changes), deployability. A traceability matrix mapping
FR → implementation section → test is cheap to produce and reads as rigorous.

### 4. System architecture
Context diagram, then component diagram (api / worker / scheduler / editor / Postgres / Redis / S3).
ERD of the schema. Sequence diagrams for the three flows that matter: **webhook → execution → response**,
**OAuth2 authorization and token refresh**, **schedule fire → queue → worker**. Then the design
decisions with their reasoning: JSONB graph storage, the item model, three services rather than one,
declarative node parameters. Lift the ADRs in `docs/adr/` directly — that is what they are for.

### 5. Implementation — step by step  ← the core of the report
Each subsection: what we are building, why, the code that matters (extracts, not whole files), the
commands to run, and how to verify it works before moving on.

| | |
|---|---|
| 5.1 | Prerequisites and environment — versions, accounts, tooling |
| 5.2 | Repository and workspace setup — pnpm workspaces, Turborepo, the shape of the tree |
| 5.3 | Docker Compose for local development — Postgres, Redis, hot reload |
| 5.4 | Database schema and migrations |
| 5.5 | The execution engine — graph building, the ready queue, branch pruning, status transitions |
| 5.6 | The item data model — why arrays of `{json, binary}`, and what it implies for node authors |
| 5.7 | The node SDK — `INode`, the descriptor, the execution context |
| 5.8 | The node registry and the auto-generated parameter panel |
| 5.9 | The expression resolver |
| 5.10 | The editor — React Flow canvas, save/load, the execution inspector |
| 5.11 | The queue and the worker |
| 5.12 | Webhook ingress — registration, test versus production URLs, response modes |
| 5.13 | The scheduler — cron registry, timezones, at-most-once delivery |
| 5.14 | Credential storage and AES-256-GCM encryption |
| 5.15 | **Google Cloud setup** — project, enabling APIs, OAuth consent screen, test users, scopes, redirect URI. Screenshot every step; this is the subsection readers will actually follow |
| 5.16 | The OAuth2 authorization code flow and refresh handling |
| 5.17 | Google Sheets node |
| 5.18 | Google Drive node and binary data |
| 5.19 | Google Docs node |
| 5.20 | Gmail node — MIME construction and base64url encoding |
| 5.21 | HTTP Request node |
| 5.22 | Code node and the `isolated-vm` sandbox — including the `vm` escape demonstration |
| 5.23 | IF, Set and Respond to Webhook |
| 5.24 | The AI node (and the agent, if Tier 2 landed) |
| 5.25 | Worked example — building the demo workflow end to end |

### 6. Deployment
Terraform layout and how to apply it. AWS resources one by one: VPC and subnets, ECR, RDS,
ElastiCache, ECS task definitions and services, ALB and ACM, CloudFront and S3, Secrets Manager,
CloudWatch. The GitHub Actions pipeline. Configuration reference (every environment variable, what it
does, what it defaults to). Cost table with monthly figures. Teardown instructions.

### 7. Testing and validation
Strategy per layer with the tooling. The FR → test traceability matrix from §3. Coverage figures. The
security testing: sandbox escape attempts, SSRF probes, credential redaction checks — with results,
including anything that failed and what was changed.

### 8. Comparison with n8n
Straight from `docs/N8N-COMPARISON.md`: feature matrix, architectural comparison, benchmark method,
results with charts, the extensibility experiment, and — critically — the honest limitations
subsection. Do not let this become a list of things n8n has that we do not.

### 9. Discussion and limitations
What we would do differently. Where the architecture would break first under real load. What ten
weeks bought and what it did not. Future work, prioritised rather than listed.

### 10. Conclusion
One page. Objectives, what was delivered against them, the one or two findings worth remembering.

### Appendices
A — Node catalogue (from `docs/NODE-SPEC.md`) · B — REST API reference (generated from OpenAPI) ·
C — Terraform listing · D — Benchmark raw data · E — Setup runbook for a fresh machine ·
F — Contribution statement per group member.

---

## Practical notes

- **Screenshots.** Google Cloud console, AWS console, the editor with a live execution, the execution
  log with a failure. Capture them while you build; you cannot re-screenshot a torn-down stack.
- **Diagrams.** Mermaid or draw.io, kept as source in `docs/diagrams/` so they can be regenerated when
  the architecture changes in Week 11.
- **Code extracts.** Twenty lines maximum, with a file path caption. Whole files go in the repository,
  not the report.
- **Every claim about n8n gets a citation** to a pinned version's docs or source.
- **Contribution statement.** Fill it in as you go from the git history; reconstructing it in Week 15
  from memory always produces an argument.
