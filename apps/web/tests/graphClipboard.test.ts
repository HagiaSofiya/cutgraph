import { actions, graphReducer } from '@cutgraph/shared';
import { describe, expect, it } from 'vitest';
import { copyNodes, pasteFragment } from '../src/state/graphClipboard';
import { GraphHistory, graphDocumentFromGraph, isGraphEditAction } from '../src/state/graphHistory';
import { makeEdge, makeGraph, makeNode, makeResult } from './helpers';

function sequentialIds() {
  let n = 0;
  return (nodeType: string) => `${nodeType}-copy-${(n += 1)}`;
}

// a -> b -> c, plus an unrelated upstream u feeding b.
function branchGraph() {
  return makeGraph(
    [
      makeNode({ id: 'a', type: 'textToImage', params: { prompt: 'a' } }),
      makeNode({ id: 'b', type: 'concat', params: {} }),
      makeNode({ id: 'c', type: 'export', params: { filename: 'c.mp4' } }),
      makeNode({ id: 'u', type: 'textToImage', params: { prompt: 'u' } }),
    ],
    [
      makeEdge({ id: 'ab', source: 'a', target: 'b', targetHandle: 'in-0' }),
      makeEdge({ id: 'bc', source: 'b', target: 'c', targetHandle: 'in' }),
      makeEdge({ id: 'ub', source: 'u', target: 'b', targetHandle: 'in-1' }),
    ],
  );
}

describe('copyNodes', () => {
  it('keeps the edges between copied nodes and drops the ones leaving the selection', () => {
    const fragment = copyNodes(branchGraph(), ['a', 'b']);
    expect(Object.keys(fragment.nodes).sort()).toEqual(['a', 'b']);
    // ab is internal and kept; ub enters from outside and bc leaves, so both go.
    expect(Object.keys(fragment.edges)).toEqual(['ab']);
  });

  it('carries no runtime state, so a copy has produced nothing yet', () => {
    const graph = branchGraph();
    graph.nodes.a = { ...graph.nodes.a, status: 'succeeded', result: makeResult('out-a'), jobId: 'j1' };
    const fragment = copyNodes(graph, ['a']);
    expect(fragment.nodes.a).toEqual({
      id: 'a',
      type: 'textToImage',
      position: { x: 0, y: 0 },
      params: { prompt: 'a' },
    });
  });

  it('ignores ids that are not in the graph', () => {
    expect(Object.keys(copyNodes(branchGraph(), ['a', 'nope']))).toEqual(['nodes', 'edges']);
    expect(Object.keys(copyNodes(branchGraph(), ['a', 'nope']).nodes)).toEqual(['a']);
  });
});

describe('pasteFragment', () => {
  it('re-ids every node and rewires the internal edges onto the new ids', () => {
    const fragment = copyNodes(branchGraph(), ['a', 'b']);
    const { nodes, edges } = pasteFragment(fragment, { x: 40, y: 40 }, sequentialIds());

    expect(nodes.map((n) => n.id)).toEqual(['textToImage-copy-1', 'concat-copy-2']);
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('textToImage-copy-1');
    expect(edges[0].target).toBe('concat-copy-2');
    expect(edges[0].targetHandle).toBe('in-0');
    // The id encodes both endpoints, so a pasted edge cannot collide with the one it came from.
    expect(edges[0].id).toBe('textToImage-copy-1:out->concat-copy-2:in-0');
  });

  it('offsets the copies so they do not land underneath the originals', () => {
    const graph = makeGraph([makeNode({ id: 'a', type: 'trim', position: { x: 100, y: 200 } })]);
    const { nodes } = pasteFragment(copyNodes(graph, ['a']), { x: 40, y: 40 }, sequentialIds());
    expect(nodes[0].position).toEqual({ x: 140, y: 240 });
  });
});

describe('NODES_PASTED', () => {
  it('adds the nodes and their edges in one action, leaving the originals alone', () => {
    const graph = branchGraph();
    const { nodes, edges } = pasteFragment(copyNodes(graph, ['a', 'b']), { x: 40, y: 40 }, sequentialIds());
    const next = graphReducer(graph, actions.nodesPasted(nodes, edges));

    expect(Object.keys(next.nodes)).toHaveLength(6);
    expect(next.nodes['textToImage-copy-1'].status).toBe('idle');
    expect(next.nodes.a).toBe(graph.nodes.a); // untouched by reference
    expect(next.edges['textToImage-copy-1:out->concat-copy-2:in-0']).toBeDefined();
  });

  it('does not invalidate anything already in the graph', () => {
    const graph = branchGraph();
    graph.nodes.c = { ...graph.nodes.c, status: 'succeeded', result: makeResult('out-c') };
    const { nodes, edges } = pasteFragment(copyNodes(graph, ['a']), { x: 40, y: 40 }, sequentialIds());
    expect(graphReducer(graph, actions.nodesPasted(nodes, edges)).nodes.c.status).toBe('succeeded');
  });

  it('skips a node id that is somehow already taken, matching NODE_ADDED', () => {
    const graph = branchGraph();
    const next = graphReducer(
      graph,
      actions.nodesPasted([{ id: 'a', type: 'trim', position: { x: 9, y: 9 }, params: {} }], []),
    );
    expect(next.nodes.a.type).toBe('textToImage');
    expect(next.nodes.a.position).toEqual({ x: 0, y: 0 });
  });

  it('is one undo step, not one per pasted node', () => {
    expect(isGraphEditAction(actions.nodesPasted([], []))).toBe(true);

    const graph = branchGraph();
    const { nodes, edges } = pasteFragment(copyNodes(graph, ['a', 'b']), { x: 40, y: 40 }, sequentialIds());
    const action = actions.nodesPasted(nodes, edges);
    const pasted = graphReducer(graph, action);

    const history = new GraphHistory();
    expect(history.record(graphDocumentFromGraph(graph), graphDocumentFromGraph(pasted), action)).toBe(true);
    expect(history.undoDepth).toBe(1);

    // One undo takes both pasted nodes and the edge between them back at once.
    const restored = graphReducer(pasted, actions.graphDocumentRestored(history.undo()!));
    expect(Object.keys(restored.nodes).sort()).toEqual(['a', 'b', 'c', 'u']);
    expect(Object.keys(restored.edges).sort()).toEqual(['ab', 'bc', 'ub']);
  });
});
