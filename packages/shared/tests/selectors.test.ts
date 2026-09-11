import { describe, expect, it } from 'vitest';
import { CycleError, hasFailedAncestor, topoSort } from '../src/reducer/selectors';
import { makeEdge, makeGraph, makeNode } from './helpers';

describe('topoSort', () => {
  it('orders a linear graph a -> b -> c', () => {
    const graph = makeGraph(
      [makeNode({ id: 'a' }), makeNode({ id: 'b' }), makeNode({ id: 'c' })],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' }), makeEdge({ id: 'bc', source: 'b', target: 'c' })],
    );
    expect(topoSort(graph)).toEqual(['a', 'b', 'c']);
  });

  it('orders a diamond graph so every source precedes its targets', () => {
    const graph = makeGraph(
      [makeNode({ id: 'a' }), makeNode({ id: 'b' }), makeNode({ id: 'c' }), makeNode({ id: 'd' })],
      [
        makeEdge({ id: 'ab', source: 'a', target: 'b' }),
        makeEdge({ id: 'ac', source: 'a', target: 'c' }),
        makeEdge({ id: 'bd', source: 'b', target: 'd' }),
        makeEdge({ id: 'cd', source: 'c', target: 'd' }),
      ],
    );
    const order = topoSort(graph);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('d'));
    expect(order.indexOf('c')).toBeLessThan(order.indexOf('d'));
  });

  it('throws CycleError on a cyclic graph', () => {
    const graph = makeGraph(
      [makeNode({ id: 'a' }), makeNode({ id: 'b' })],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' }), makeEdge({ id: 'ba', source: 'b', target: 'a' })],
    );
    expect(() => topoSort(graph)).toThrow(CycleError);
  });

  it('restricts to ancestors of the given target nodes', () => {
    // a -> b -> c, and an unrelated branch x -> y
    const graph = makeGraph(
      [
        makeNode({ id: 'a' }),
        makeNode({ id: 'b' }),
        makeNode({ id: 'c' }),
        makeNode({ id: 'x' }),
        makeNode({ id: 'y' }),
      ],
      [
        makeEdge({ id: 'ab', source: 'a', target: 'b' }),
        makeEdge({ id: 'bc', source: 'b', target: 'c' }),
        makeEdge({ id: 'xy', source: 'x', target: 'y' }),
      ],
    );
    expect(topoSort(graph, ['b'])).toEqual(['a', 'b']);
  });
});

describe('hasFailedAncestor', () => {
  it('is true when an upstream node has failed', () => {
    const graph = makeGraph(
      [makeNode({ id: 'a', status: 'failed' }), makeNode({ id: 'b' })],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' })],
    );
    expect(hasFailedAncestor(graph, 'b')).toBe(true);
  });

  it('is false when no upstream node has failed', () => {
    const graph = makeGraph(
      [makeNode({ id: 'a', status: 'succeeded' }), makeNode({ id: 'b' })],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' })],
    );
    expect(hasFailedAncestor(graph, 'b')).toBe(false);
  });
});
