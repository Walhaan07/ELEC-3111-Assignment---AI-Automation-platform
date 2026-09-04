# ADR-0001 — Store the workflow graph as JSONB

**Status:** Accepted (Week 4) · **Decision owner:** Stream A

## Context
A workflow is a graph of nodes with parameters and connections. It can be stored relationally
(`nodes`, `node_parameters`, `connections` tables) or as a document on the workflow row.

## Decision
Store `nodes` and `connections` as `jsonb` columns on `workflows`. This is also what n8n does.

## Consequences
- Loading or saving a workflow is a single-row operation; the editor sends the whole canvas back.
- Versioning is a row copy.
- Node parameters are schemaless, which suits a node SDK where each node defines its own parameters.
- **Cost:** no SQL query over node contents without a JSONB scan (e.g. "which workflows use Gmail").
  Acceptable at this scale; add a GIN index if it ever matters.
- **Cost:** no database-level referential integrity between connections and nodes. The engine
  validates the graph at save time — cycles, dangling connections, duplicate node names.
