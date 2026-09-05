# AI Automation Platform — ELEC 3111, Group 2

An end-to-end AI automation platform built as a flexible alternative to n8n. Workflows are graphs of
nodes connecting event triggers, custom scripts and external services, executed by a queue-backed
engine.

**Assignment:** develop an AI automation platform similar to n8n, including the most important nodes
(Schedule trigger, Webhook, HTTP, Google APIs — Docs/Sheets/Drive/Gmail — Code node, etc.), and
compare the application with n8n. **Demo:** Week 14. **Report:** Week 15.

## Core nodes

- **Triggers** — Schedule (cron/interval, timezone-aware) and Webhook (test and production URLs)
- **HTTP Request** — REST calls with auth, pagination and binary responses
- **Google Workspace** — Sheets, Drive, Docs and Gmail over OAuth2
- **Code** — user JavaScript in a V8 isolate sandbox
- **Control flow** — IF, Edit Fields, Respond to Webhook
- **AI** — an LLM node, with a tool-calling agent as a stretch goal

## Stack

Node.js 22 + TypeScript · Express · Postgres · React + React Flow · Docker Compose · AWS EC2
*(Redis + BullMQ and container orchestration are planned upgrades, not starting points — see the
build guide.)*

## Documentation

| Document | What it covers |
|---|---|
| [`docs/BUILD-GUIDE.md`](docs/BUILD-GUIDE.md) | **Start here** — what the project actually is, then fifteen stages from a 40-line engine to the demo |
| [`docs/PLAN.md`](docs/PLAN.md) | Scope, weekly schedule, work split, risks, demo plan |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Services, data model, execution engine, sandbox, credentials, AWS topology |
| [`docs/NODE-SPEC.md`](docs/NODE-SPEC.md) | The node SDK contract and the node catalogue |
| [`docs/N8N-COMPARISON.md`](docs/N8N-COMPARISON.md) | Feature matrix, architectural comparison, benchmark methodology |
| [`docs/REPORT-OUTLINE.md`](docs/REPORT-OUTLINE.md) | Week 15 report structure and writing schedule |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
| [`docs/deck/`](docs/deck/) | **The complete build guide as a printable book** — 121 pages, 33 diagrams: every step, every click, every line of code, what the output should look like, and how each part connects to the others |
