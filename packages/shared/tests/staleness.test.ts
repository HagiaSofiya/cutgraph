import { describe, expect, it } from 'vitest';
import { markStaleIfMeaningful, propagateStale } from '../src/reducer/staleness';
import { makeEdge, makeGraph, makeNode, makeResult, statusOf } from './helpers';

describe('markStaleIfMeaningful', () => {
  it('leaves an untouched idle node with no result as idle (not a generic dirty flag)', () => {
    const node = makeNode({ id: 'a', status: 'idle' });
    expect(markStaleIfMeaningful(node)).toBe('idle');
  });

  it('marks a succeeded node (with a result) as stale', () => {
    const node = makeNode({ id: 'a', status: 'succeeded', result: makeResult('a') });
    expect(markStaleIfMeaningful(node)).toBe('stale');
  });

  it('marks a queued node as stale even with no result yet', () => {
    const node = makeNode({ id: 'a', status: 'queued' });
    expect(markStaleIfMeaningful(node)).toBe('stale');
  });

  it('marks a running node as stale', () => {
    const node = makeNode({ id: 'a', status: 'running' });
    expect(markStaleIfMeaningful(node)).toBe('stale');
  });

  it('leaves a failed node with no prior result unchanged', () => {
    const node = makeNode({ id: 'a', status: 'failed' });
    expect(markStaleIfMeaningful(node)).toBe('failed');
  });
});

describe('propagateStale', () => {
  it('propagates downstream through a diamond graph and leaves the unrelated branch untouched', () => {
    // a -> b -> d
    // a -> c -> d
    // e (unrelated, no edges at all)
    const graph = makeGraph(
      [
        makeNode({ id: 'a', status: 'succeeded', result: makeResult('a') }),
        makeNode({ id: 'b', status: 'succeeded', result: makeResult('b') }),
        makeNode({ id: 'c', status: 'succeeded', result: makeResult('c') }),
        makeNode({ id: 'd', status: 'succeeded', result: makeResult('d') }),
        makeNode({ id: 'e', status: 'succeeded', result: makeResult('e') }),
      ],
      [
        makeEdge({ id: 'ab', source: 'a', target: 'b' }),
        makeEdge({ id: 'ac', source: 'a', target: 'c' }),
        makeEdge({ id: 'bd', source: 'b', target: 'd' }),
        makeEdge({ id: 'cd', source: 'c', target: 'd' }),
      ],
    );

    const next = propagateStale(graph, ['a']);

    expect(statusOf(next, 'a')).toBe('stale');
    expect(statusOf(next, 'b')).toBe('stale');
    expect(statusOf(next, 'c')).toBe('stale');
    expect(statusOf(next, 'd')).toBe('stale');
    expect(statusOf(next, 'e')).toBe('succeeded'); // untouched: not reachable from 'a'
  });

  it('does not mark idle nodes with no result as stale during propagation', () => {
    const graph = makeGraph(
      [
        makeNode({ id: 'a', status: 'succeeded', result: makeResult('a') }),
        makeNode({ id: 'b', status: 'idle' }), // never run
      ],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' })],
    );

    const next = propagateStale(graph, ['a']);
    expect(statusOf(next, 'a')).toBe('stale');
    expect(statusOf(next, 'b')).toBe('idle');
  });

  it('does not loop forever on a graph with a cycle', () => {
    const graph = makeGraph(
      [
        makeNode({ id: 'a', status: 'succeeded', result: makeResult('a') }),
        makeNode({ id: 'b', status: 'succeeded', result: makeResult('b') }),
      ],
      [
        makeEdge({ id: 'ab', source: 'a', target: 'b' }),
        makeEdge({ id: 'ba', source: 'b', target: 'a' }),
      ],
    );

    const next = propagateStale(graph, ['a']);
    expect(statusOf(next, 'a')).toBe('stale');
    expect(statusOf(next, 'b')).toBe('stale');
  });
});
