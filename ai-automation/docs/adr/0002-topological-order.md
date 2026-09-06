# ADR 0002 — The engine runs nodes in topological order

**Status:** accepted, week 4 · **Supersedes:** the ready-list loop sketched in phase 1

## Context

The first engine kept a ready list: run a node, then push each of its targets
onto the list with the items that branch produced.

It is short and it reads well. It has one flaw, and we ship the node that
exposes it.

## The flaw

**Merge has two inputs.** Under a ready list it is pushed once per incoming
line, so it runs twice, each time seeing only half of its input. The symptom is
"Merge sometimes drops rows", and it is miserable to debug because each half
looks correct on its own.

## Decision

Before running anything, `runWorkflow()`:

1. finds the single trigger,
2. walks the graph to find the nodes the trigger can actually reach,
3. sorts those with Kahn's algorithm, and
4. runs each node once, gathering every line that feeds it.

`validateWorkflow()` rejects a cycle up front, naming the nodes on the loop —
a cycle has no topological order, and `"this workflow loops: A -> B -> A"` is a
better message than a step limit tripping a thousand iterations later.

## Consequences

- Merge sees both branches in one call. So does any future node with two inputs.
- Two runs of the same workflow choose the same order, so timings are comparable
  between runs — which the benchmark chapter depends on.
- A disconnected island never runs, because it is not reachable from the trigger.
- Branch pruning is unchanged: a node whose every incoming line is empty is
  skipped, and the skip cascades. That is still how the false side of an IF stops.
- The `maxSteps` guard stays as a second belt, even though the sort makes a
  runaway impossible today.

## Cost

Loops inside a workflow are impossible. n8n allows them; we do not, and the
report says so. Iterating over items is the Code node's job instead.
