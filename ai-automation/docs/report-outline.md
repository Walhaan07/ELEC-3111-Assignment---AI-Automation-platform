# The report — written from week 5, a section at a time

Write it as it is built. You cannot re-screenshot a server you have already
shut down.

## 1 · Introduction
The problem, the choice to build an n8n-shaped platform, and the scope we set.

## 2 · Background
What n8n is, what a workflow automation platform does, and the specific pieces
we set out to reproduce: triggers, HTTP, Google Workspace, a code node, AI.

## 3 · System design
- The three ideas: a workflow is text; a node is one file with two halves;
  everything travels as items. Diagrams from `docs/architecture.md`.
- The seams table — the promises that let eight people work in parallel.
- The four ADRs, each with the alternative we rejected and why.

## 4 · Implementation
One subsection per phase, each with the code that carries the idea:
1. The engine — the loop, the guards, the error that names its node.
2. Database and server — five routes, two tables, optimistic locking.
3. The schema-driven panel and expressions — the hundred lines that made
   weeks 8–10 possible.
4. Webhooks and schedules — idempotency, HMAC, `protect: true`.
5. Google and AI — OAuth, AES-256-GCM, the shared request helper, batching.
6. Deployment, testing, measurement.

## 5 · Testing
The four levels, what each catches, and the numbers: test count, duration, and
**branch** coverage on `engine.js` (branch coverage is the honest one — it says
the error paths ran, not just the happy path).

Include the six deliberate failures from the demo checklist as evidence that
the platform fails safely. Failing safely is most of what "robust" means.

## 6 · Evaluation against n8n
- Method: the same three workflows, the same k6 script, the same container
  limits, the pinned n8n version, three runs each.
- Results: p(95) and p(99) side by side, with the raw JSON in the appendix.
- **Time to add a new node** — measured on both. We win this clearly, and
  nobody else will think to measure it.
- Honesty: n8n does far more per run than we do (queue mode, two workers,
  binary data, credential sharing, a node library in the hundreds). Being faster
  mostly means we do less. Say so.

## 7 · Limitations
No loops inside a workflow (ADR 0002). One process, not a queue. The Code node
sandbox. Testing-mode OAuth expiring after seven days. Thirteen node types.

## 8 · Reflection and project management
Eight people, eight areas, the Thursday integration habit, what the seams table
prevented, and what we would change.

## Appendices
- A: the raw k6 JSON, all eighteen files.
- B: the schema.
- C: the CI configuration and a green run.
- D: screenshots of every deliberate failure.
