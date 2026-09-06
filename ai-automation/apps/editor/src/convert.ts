import type { Node as RfNode, Edge } from '@xyflow/react';
import type { Workflow, WorkflowNode } from './types';

/**
 * Our format -> React Flow's, and back.
 *
 * These two functions are where every canvas bug would live for the rest of the
 * semester, so they are written defensively and tested both ways.
 *
 * The frozen promise: branch index === React Flow sourceHandle, and branch 0 is
 * the IF node's TRUE output.
 */

// laid out in a diagonal so a workflow with no saved positions is still readable
const fallbackPosition = (i: number) => ({ x: 80 + i * 260, y: 120 + (i % 2) * 140 });

export function toReactFlow(wf: Workflow): { nodes: RfNode[]; edges: Edge[] } {
  const nodes: RfNode[] = (wf.nodes ?? []).map((n, i) => ({
    id: n.name,
    type: 'workflowNode',
    position: n.position ?? fallbackPosition(i),
    data: { node: n },
    dragHandle: undefined,
  }));

  const known = new Set(nodes.map((n) => n.id));

  const edges: Edge[] = Object.entries(wf.connections ?? {}).flatMap(([from, branches]) =>
    (branches ?? []).flatMap((targets, branchIndex) =>
      (targets ?? [])
        // a connection to a deleted node would crash React Flow - drop it quietly
        .filter((to) => known.has(to) && known.has(from))
        .map((to) => ({
          id: `${from}:${branchIndex}->${to}`,
          source: from,
          target: to,
          sourceHandle: String(branchIndex),
          targetHandle: 'in',
          type: 'workflowEdge',
        }))));

  return { nodes, edges };
}

export function fromReactFlow(nodes: RfNode[], edges: Edge[]): Pick<Workflow, 'nodes' | 'connections'> {
  const connections: Record<string, string[][]> = {};

  for (const e of edges) {
    const branch = Number.isFinite(Number(e.sourceHandle)) ? Number(e.sourceHandle) : 0;
    connections[e.source] ??= [];
    for (let b = 0; b <= branch; b++) connections[e.source][b] ??= [];   // no holes in the array
    if (!connections[e.source][branch].includes(e.target)) {             // no duplicate edges
      connections[e.source][branch].push(e.target);
    }
  }

  return {
    nodes: nodes.map((n) => ({
      ...((n.data as { node: WorkflowNode }).node),
      name: n.id,
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
    })),
    connections,
  };
}

/** Round-trip guard - called in a test, and in dev after every save. */
export function isLossless(wf: Workflow): boolean {
  const { nodes, edges } = toReactFlow(wf);
  const back = fromReactFlow(nodes, edges);
  return JSON.stringify(back.connections) === JSON.stringify(wf.connections);
}

/** "HTTP Request" already taken? Then "HTTP Request 1". */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 1; i < 1000; i++) {
    if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
  }
  return `${base} ${Date.now()}`;
}

/**
 * Renaming a node has to rewrite every line that pointed at it, or the
 * workflow silently loses its connections.
 */
export function renameNode(wf: Workflow, from: string, to: string): Workflow {
  if (from === to) return wf;
  const connections: Record<string, string[][]> = {};
  for (const [source, branches] of Object.entries(wf.connections ?? {})) {
    connections[source === from ? to : source] =
      (branches ?? []).map((targets) => (targets ?? []).map((t) => (t === from ? to : t)));
  }
  return {
    ...wf,
    nodes: (wf.nodes ?? []).map((n) => (n.name === from ? { ...n, name: to } : n)),
    connections,
  };
}
