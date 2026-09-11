import { describe, expect, it } from 'vitest';
import { reconcileFlowNodes } from '../src/canvas/reconcileFlowNodes';
import type { CutgraphNode } from '../src/canvas/types';
import { makeGraph, makeNode } from './helpers';

describe('reconcileFlowNodes', () => {
  it('preserves the flow node reference (including data) for every node that did not change', () => {
    const graph = makeGraph([makeNode({ id: 'a' }), makeNode({ id: 'b' })]);
    const initial = reconcileFlowNodes([], graph, null);

    const nextGraph = { ...graph, nodes: { ...graph.nodes, a: { ...graph.nodes.a, position: { x: 5, y: 5 } } } };
    // Only 'a' actually changed reference (position bumped); 'b' is untouched.
    const next = reconcileFlowNodes(initial, nextGraph, graph);

    const a = next.find((n) => n.id === 'a')!;
    const b = next.find((n) => n.id === 'b')!;
    const prevA = initial.find((n) => n.id === 'a')!;
    const prevB = initial.find((n) => n.id === 'b')!;

    expect(a).not.toBe(prevA); // patched
    expect(a.data.node).toBe(nextGraph.nodes.a); // points at the new logical node
    expect(b).toBe(prevB); // completely untouched -- same object reference
    expect(b.data).toBe(prevB.data);
  });

  it('adds a node newly present in the graph without disturbing existing entries', () => {
    const graph = makeGraph([makeNode({ id: 'a' })]);
    const initial = reconcileFlowNodes([], graph, null);

    const nextGraph = makeGraph([graph.nodes.a, makeNode({ id: 'b' })]);
    const next = reconcileFlowNodes(initial, nextGraph, graph);

    expect(next.map((n) => n.id).sort()).toEqual(['a', 'b']);
    const a = next.find((n) => n.id === 'a')!;
    expect(a).toBe(initial[0]); // 'a' untouched by the addition of 'b'
  });

  it('removes a node no longer present in the graph', () => {
    const graph = makeGraph([makeNode({ id: 'a' }), makeNode({ id: 'b' })]);
    const initial = reconcileFlowNodes([], graph, null);

    const nextGraph = makeGraph([graph.nodes.a]); // 'b' removed
    const next = reconcileFlowNodes(initial, nextGraph, graph);

    expect(next.map((n) => n.id)).toEqual(['a']);
  });

  it('never mutates the flow nodes it was given', () => {
    const graph = makeGraph([makeNode({ id: 'a' })]);
    const initial = reconcileFlowNodes([], graph, null) as CutgraphNode[];
    const snapshot = JSON.stringify(initial);

    reconcileFlowNodes(initial, graph, graph);
    expect(JSON.stringify(initial)).toBe(snapshot);
  });
});
