# ELEC 3111 · AI Automation Platform

An end-to-end AI automation platform designed as a flexible alternative to n8n.
Built for ELEC 3111, this platform enables automated workflow creation by
connecting event triggers, custom scripts, and external services through modular
node execution.

## The code lives in [`ai-automation/`](ai-automation/)

```bash
cd ai-automation
cp .env.example .env
npm install
docker compose up -d --wait
npm run seed
npm run dev            # editor http://localhost:5173 · api http://localhost:5678
```

See [`ai-automation/README.md`](ai-automation/README.md) for the full guide, and
[`ai-automation/docs/`](ai-automation/docs/) for the architecture notes, the ADRs
and the printable build guide.

## Key features and core nodes

**Triggers and webhooks.** Cron schedules and real-time HTTP webhook handlers,
with HMAC signature verification, per-IP rate limiting, and idempotency so a
retried delivery never does the work twice.

**HTTP and API integration.** A single shared HTTP helper — timeouts, retries
with jittered backoff, and 4xx/5xx handling — used by every node in the
platform.

**Google Workspace suite.** Sheets, Drive, Docs and Gmail, behind one OAuth 2.0
round trip. Tokens are encrypted at rest with AES-256-GCM and never reach a
browser.

**Code execution node.** User JavaScript in a worker thread with both a timeout
and a memory limit.

**AI node.** A language model call whose prompt is an ordinary expression, so it
can be built from the item flowing through it, and whose JSON answer feeds
straight into an IF node.

**Benchmarking and analysis.** k6 scripts and a pinned n8n stack under identical
container limits, for an architectural and performance comparison.

## What is in the box

| | |
| --- | --- |
| Node types | 13 — triggers, flow, transform, Google, AI |
| Automated tests | 142 unit/integration + 2 browser tests |
| HTTP routes | 14 REST routes, plus webhooks and OAuth |
| Live canvas | React Flow, with per-node run state streamed over SSE |
