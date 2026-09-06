# ADR 0001 — A workflow is one piece of JSON

**Status:** accepted, week 3 · **Deciders:** all eight

## Context

The canvas and the engine are built by different pairs, in parallel, from
week 3. They need something to agree on that neither of them owns.

## Decision

A workflow is a list of boxes and a list of lines:

```json
{
  "nodes": [
    { "name": "Webhook", "type": "webhook", "parameters": { "path": "new-order" },
      "position": { "x": 80, "y": 160 } }
  ],
  "connections": { "Webhook": [["Code"]] }
}
```

`connections[from][branchIndex]` is the list of node **names** fed by that
output. It is stored in a single `jsonb` column.

## Consequences

- Saving is one write, loading is one read, copying a workflow is copying a row.
- The canvas only has to produce this text; the engine only has to read it.
- Nodes are addressed by name, so **renaming a node must rewrite every
  connection that pointed at it** — `renameNode()` in `convert.ts` does that,
  and a test holds it.
- Exporting is `curl` and a file, and importing is a POST. We got that free.

## Alternatives considered

Numeric ids with a separate name field. Better for renaming, worse for reading
a stored workflow while debugging — and every example in the guide, and n8n
itself, uses names. Not worth the divergence.
