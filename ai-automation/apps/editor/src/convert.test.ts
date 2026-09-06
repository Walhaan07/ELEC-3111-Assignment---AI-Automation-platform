import { test, expect, describe } from 'vitest';
import { toReactFlow, fromReactFlow, isLossless, uniqueName, renameNode } from './convert';
import type { Workflow } from './types';

const sample: Workflow = {
  name: 'demo',
  nodes: [
    { name: 'A', type: 'if', parameters: {}, position: { x: 0, y: 0 } },
    { name: 'B', type: 'set', parameters: {}, position: { x: 200, y: 0 } },
    { name: 'C', type: 'set', parameters: {}, position: { x: 200, y: 120 } },
  ],
  connections: { A: [['B'], ['C']] },        // branch 0 -> B, branch 1 -> C (an IF node)
};

describe('the canvas translator', () => {
  test('a workflow survives a round trip through React Flow unchanged', () => {
    const { nodes, edges } = toReactFlow(sample);
    expect(fromReactFlow(nodes, edges).connections).toEqual(sample.connections);
    expect(isLossless(sample)).toBe(true);
  });

  test('branch 0 becomes sourceHandle "0", which the IF node draws as true', () => {
    const { edges } = toReactFlow(sample);
    expect(edges.find((e) => e.target === 'B')?.sourceHandle).toBe('0');
    expect(edges.find((e) => e.target === 'C')?.sourceHandle).toBe('1');
  });

  test('an edge to a deleted node is dropped, not crashed on', () => {
    const broken = { ...sample, connections: { A: [['B'], ['GHOST']] } };
    expect(toReactFlow(broken).edges).toHaveLength(1);
  });

  test('positions are kept, and rounded', () => {
    const { nodes } = toReactFlow(sample);
    nodes[0].position = { x: 12.4, y: 88.6 };
    expect(fromReactFlow(nodes, []).nodes[0].position).toEqual({ x: 12, y: 89 });
  });

  test('a node with no saved position still gets one', () => {
    const { nodes } = toReactFlow({ name: 'x', nodes: [{ name: 'N', type: 'set', parameters: {} }], connections: {} });
    expect(nodes[0].position).toEqual({ x: 80, y: 120 });
  });

  test('a duplicate edge is only stored once', () => {
    const { nodes } = toReactFlow(sample);
    const twice = [
      { id: 'e1', source: 'A', target: 'B', sourceHandle: '0' },
      { id: 'e2', source: 'A', target: 'B', sourceHandle: '0' },
    ] as any;
    expect(fromReactFlow(nodes, twice).connections.A).toEqual([['B']]);
  });

  test('a branch-1 edge with no branch-0 edge leaves no hole in the array', () => {
    const { nodes } = toReactFlow(sample);
    const only = [{ id: 'e', source: 'A', target: 'C', sourceHandle: '1' }] as any;
    expect(fromReactFlow(nodes, only).connections.A).toEqual([[], ['C']]);
  });
});

describe('naming', () => {
  test('a duplicate name gets a number', () => {
    expect(uniqueName('Set', ['Set', 'Set 1'])).toBe('Set 2');
    expect(uniqueName('Set', [])).toBe('Set');
  });

  test('renaming rewrites every connection that pointed at the old name', () => {
    const renamed = renameNode(sample, 'B', 'Bee');
    expect(renamed.connections.A).toEqual([['Bee'], ['C']]);
    expect(renamed.nodes.map((n) => n.name)).toEqual(['A', 'Bee', 'C']);
  });

  test('renaming the source rewrites the key too', () => {
    const renamed = renameNode(sample, 'A', 'Ay');
    expect(renamed.connections.Ay).toEqual([['B'], ['C']]);
    expect(renamed.connections.A).toBeUndefined();
  });
});
