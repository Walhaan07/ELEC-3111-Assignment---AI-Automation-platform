# ADR-0002 — Nodes exchange arrays of items, not single objects

**Status:** Accepted (Week 5) · **Decision owner:** Stream A

## Context
Data passing between nodes could be a single JSON object per execution, or an array of items with
each node running once per item, or an array of items with each node running once for all of them.
This choice cannot be changed later without rewriting every node.

## Decision
Adopt n8n's model. A node receives `INodeExecutionData[]` and returns `INodeExecutionData[][]` —
one array per output branch. A node executes **once** with all its items and loops internally.

## Consequences
- Fan-out is natural: one Sheets read produces 100 items and the next node handles all 100.
- Multiple outputs fall out for free, which is how IF branches.
- A node returning zero items prunes its downstream branch — the engine's readiness check must use
  item counts, not just graph topology.
- Node authors must write loops. The SDK's `getNodeParameter(name, itemIndex)` makes per-item
  expression resolution the default path so this stays cheap.
- The comparison with n8n becomes like-for-like, and anyone who has used n8n already has the model.

## Rejected
*One object per execution* — cannot express fan-out; every integration would need its own batching.
*Engine-level per-item iteration* — forces N HTTP calls where one batched call would do, and makes
efficient integrations impossible to write.
