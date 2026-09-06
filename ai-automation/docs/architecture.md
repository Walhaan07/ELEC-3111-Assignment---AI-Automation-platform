# How the parts connect

Every arrow below is a promise one pair makes to another. Nothing crosses a box
boundary except the labelled arrows — that single rule is what lets four pairs
work in four folders without waiting for each other.

```
                    ┌────────────────────────────────────────────┐
                    │  The editor · apps/editor        B1 B2     │
                    │  canvas (React Flow) · settings panel      │
                    │  executions list · credentials             │
                    └───────────────┬────────────────────────────┘
       down: workflow JSON          │        up: node descriptions,
       { nodes[], connections{},    │        run results, live events
         version }                  │
                    ┌───────────────▼────────────────────────────┐
                    │  The server · apps/api           C1 C2     │
                    │                                            │
                    │  REST routes  Webhooks  Scheduler  OAuth   │
                    │  5 routes     HMAC      croner     AES-GCM │
                    │  409 on       idempotency  protect  crypto │
                    │  stale saves                               │
                    │                                            │
                    │  db.js — one pool, one withTransaction()   │
                    └───────┬───────────────────────┬────────────┘
     runWorkflow(wf,        │                       │
     nodeTypes) returns     │                       │  PostgreSQL
     { results, log, steps }│                       │  workflows · executions
                    ┌───────▼──────────┐            │  credentials · webhooks
                    │  The engine      │            │  schedules · deliveries
                    │  packages/engine │            └────────────
                    │        A1        │
                    │  topological loop│
                    │  items · errors  │
                    │  http · expressions
                    └───────┬──────────┘
   engine → node · ctx:     │    node → engine · branches:
   getInputData             │    [[{ json: {…} }], …]
   getNodeParameter         │    one array per output
   getRawNodeParameter      │
   helpers · logger         │
   credentialId             │
                    ┌───────▼──────────────────────────┐
                    │  The nodes · packages/nodes A2 D1│
                    │  description.properties[]        │
                    │  out to Google · AI · HTTP       │
                    └──────────────────────────────────┘
```

## The seams, and who owns them

| Seam | Shape | Agreed by |
| --- | --- | --- |
| `ctx` | `getInputData`, `getNodeParameter`, `getRawNodeParameter`, `helpers`, `logger`, `credentialId` | A1 freezes it in week 3 |
| Node output | `[[item, …], [item, …]]` — one array per output branch | A1 · A2 |
| Branch index | branch 0 is the IF node's **true** output, and equals React Flow's `sourceHandle` | A2 · B1 · B2 |
| Workflow JSON | `{ id, name, nodes[], connections{}, version }` | everyone |
| `version` | the canvas sends the number it loaded; the server answers 409 if it is stale | B1 · C1 |
| Trigger item | `{ headers, query, body, method, receivedAt }` | C2 |
| Credential | `node.credentials.id` on the workflow JSON | B1 · C1 · D1 |
| Live events | `node-started` · `node-finished` · `node-error` · `node-skipped` over SSE | A1 · B2 |

If a change would add a ninth arrow, that is a ten-minute group conversation,
not a pull request somebody discovers on Thursday.

## Why the engine runs in topological order

The obvious loop keeps a ready list and pushes each target as soon as a branch
produces items. It is three lines shorter, and it runs a node **once per
incoming line**.

That is wrong for exactly one node, and it is a node we ship: **Merge** has two
inputs. Under a ready list it runs twice, each time with half the data, and the
bug looks like "Merge sometimes drops rows".

So the engine sorts the reachable nodes topologically first and runs each one
once, gathering every line that feeds it. A cycle has no topological order, so
`validateWorkflow` rejects one up front with the names on the loop — a clearer
message than hitting a step limit a thousand iterations later, and the step
limit is still there as a second belt.

See [`docs/adr/0002-topological-order.md`](adr/0002-topological-order.md).

## The two places data changes shape

Exactly two functions translate between representations, and both are tested
in both directions:

- `apps/editor/src/convert.ts` — our workflow JSON ⇄ React Flow's nodes and edges.
- `packages/nodes/google/request.js` — a credential id ⇄ a live Google access token.

Code that translates between two boxes belongs to one of them, never both.
