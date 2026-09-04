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

Node.js 22 + TypeScript · NestJS · Postgres · Redis + BullMQ · React + React Flow · Docker ·
Terraform · AWS ECS Fargate

## Documentation

| Document | What it covers |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | **Start here** — scope, weekly schedule, work split, risks, demo plan |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Services, data model, execution engine, sandbox, credentials, AWS topology |
| [`docs/NODE-SPEC.md`](docs/NODE-SPEC.md) | The node SDK contract and the node catalogue |
| [`docs/N8N-COMPARISON.md`](docs/N8N-COMPARISON.md) | Feature matrix, architectural comparison, benchmark methodology |
| [`docs/REPORT-OUTLINE.md`](docs/REPORT-OUTLINE.md) | Week 15 report structure and writing schedule |
| [`docs/adr/`](docs/adr/) | Architecture decision records |
