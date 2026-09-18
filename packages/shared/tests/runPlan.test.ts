import { describe, expect, it } from 'vitest';
import { deriveCacheKey } from '../src/cache/cacheKey';
import { classifyRunNode, selectRunPlan } from '../src/reducer/runPlan';
import { makeEdge, makeGraph, makeNode, makeResult } from './helpers';

function dispositionOf(plan: ReturnType<typeof selectRunPlan>, nodeId: string): string {
  const entry = plan.entries.find((e) => e.nodeId === nodeId);
  if (!entry) throw new Error(`node ${nodeId} is not in the plan`);
  return entry.disposition;
}

describe('selectRunPlan', () => {
  it('plans a fresh linear graph as all-execute, splitting generations from client-side work', () => {
    const graph = makeGraph(
      [
        makeNode({ id: 'a', type: 'textToImage', params: { prompt: 'a cat' } }),
        makeNode({ id: 'b', type: 'imageToVideo', params: { prompt: 'pan', duration: 4 } }),
        makeNode({ id: 'c', type: 'trim', params: { start: 0, end: 2 } }),
      ],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' }), makeEdge({ id: 'bc', source: 'b', target: 'c' })],
    );

    const plan = selectRunPlan(graph, ['c']);
    expect(plan.entries.map((e) => e.disposition)).toEqual(['execute', 'execute', 'execute']);
    expect(plan.generations).toBe(2);
    expect(plan.clientSide).toBe(1);
    expect(plan.cached).toBe(0);
    expect(plan.blocked).toBe(0);
  });

  it('predicts a downstream node past an upstream that has not run yet', () => {
    // The whole point of the transitive walk: `b`'s cache key depends on `a`'s output id, and
    // `a` has not produced one. A naive resolveUpstream-style check would call `b` blocked.
    const graph = makeGraph(
      [
        makeNode({ id: 'a', type: 'textToImage', params: { prompt: 'a cat' } }),
        makeNode({ id: 'b', type: 'imageToVideo', params: { prompt: 'pan' } }),
      ],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' })],
    );

    const plan = selectRunPlan(graph, ['b']);
    expect(dispositionOf(plan, 'b')).toBe('execute');

    // And the key it predicted is the one the run would derive, given a's predicted output.
    const keyOfA = plan.entries.find((e) => e.nodeId === 'a')!.cacheKey!;
    const keyOfB = plan.entries.find((e) => e.nodeId === 'b')!.cacheKey!;
    expect(keyOfB).toBe(
      deriveCacheKey({
        nodeType: 'imageToVideo',
        params: { prompt: 'pan' },
        upstream: [{ handle: null, sourceNodeId: 'a', outputId: keyOfA }],
      }),
    );
  });

  it('reports a node whose derived key is already in resultCache as a free cache hit', () => {
    const graph = makeGraph([makeNode({ id: 'a', type: 'textToImage', params: { prompt: 'a cat' } })]);
    const key = deriveCacheKey({ nodeType: 'textToImage', params: { prompt: 'a cat' }, upstream: [] });
    graph.resultCache[key] = makeResult(key);

    const plan = selectRunPlan(graph, ['a']);
    expect(dispositionOf(plan, 'a')).toBe('cached');
    expect(plan.generations).toBe(0);
    expect(plan.cached).toBe(1);
  });

  it('counts two generation nodes deriving the same key as one generation, not two', () => {
    // runGraph joins these into a single adapter call, so counting nodes would overstate the
    // bill by exactly the thing the in-flight join exists to prevent.
    const graph = makeGraph([
      makeNode({ id: 'a', type: 'textToImage', params: { prompt: 'same' } }),
      makeNode({ id: 'b', type: 'textToImage', params: { prompt: 'same' } }),
      makeNode({ id: 'c', type: 'textToImage', params: { prompt: 'different' } }),
    ]);

    const plan = selectRunPlan(graph, ['a', 'b', 'c']);
    expect(plan.entries.every((e) => e.disposition === 'execute')).toBe(true);
    expect(plan.generations).toBe(2);
  });

  it('treats a succeeded node as settled and feeds its real result id downstream', () => {
    const graph = makeGraph(
      [
        makeNode({ id: 'a', type: 'textToImage', status: 'succeeded', result: makeResult('out-a') }),
        makeNode({ id: 'b', type: 'trim', params: { start: 0, end: 1 } }),
      ],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' })],
    );

    const plan = selectRunPlan(graph, ['b']);
    expect(dispositionOf(plan, 'a')).toBe('settled');
    expect(dispositionOf(plan, 'b')).toBe('execute');
    expect(plan.entries.find((e) => e.nodeId === 'b')!.cacheKey).toBe(
      deriveCacheKey({
        nodeType: 'trim',
        params: { start: 0, end: 1 },
        upstream: [{ handle: null, sourceNodeId: 'a', outputId: 'out-a' }],
      }),
    );
    expect(plan.generations).toBe(0);
    expect(plan.clientSide).toBe(1);
  });

  it('blocks everything downstream of an in-flight node, which the run will skip without a result', () => {
    const graph = makeGraph(
      [
        makeNode({ id: 'a', type: 'imageToVideo', status: 'running', jobId: 'job-1' }),
        makeNode({ id: 'b', type: 'trim' }),
        makeNode({ id: 'c', type: 'export' }),
      ],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' }), makeEdge({ id: 'bc', source: 'b', target: 'c' })],
    );

    const plan = selectRunPlan(graph, ['c']);
    expect(dispositionOf(plan, 'a')).toBe('settled');
    expect(dispositionOf(plan, 'b')).toBe('blocked');
    expect(dispositionOf(plan, 'c')).toBe('blocked');
    expect(plan.blocked).toBe(2);
    expect(plan.entries.find((e) => e.nodeId === 'b')!.cacheKey).toBeUndefined();
  });

  it('plans a stale node as work again, which is what makes edit-and-revert show as cached', () => {
    const graph = makeGraph([makeNode({ id: 'a', type: 'textToImage', params: { prompt: 'p' }, status: 'stale' })]);
    expect(dispositionOf(selectRunPlan(graph, ['a']), 'a')).toBe('execute');

    const key = deriveCacheKey({ nodeType: 'textToImage', params: { prompt: 'p' }, upstream: [] });
    graph.resultCache[key] = makeResult(key);
    expect(dispositionOf(selectRunPlan(graph, ['a']), 'a')).toBe('cached');
  });
});

describe('classifyRunNode', () => {
  it('reports an unknown node as settled rather than throwing', () => {
    expect(classifyRunNode(makeGraph([]), 'nope', []).disposition).toBe('settled');
  });

  it('checks the status gate before the upstream, matching executeNode-s own order', () => {
    // A succeeded node with an unresolved upstream is skipped for being settled, not blocked --
    // the distinction matters because only 'blocked' propagates downstream.
    const graph = makeGraph([makeNode({ id: 'a', status: 'succeeded', result: makeResult('r') })]);
    expect(classifyRunNode(graph, 'a', undefined).disposition).toBe('settled');
  });

  it('returns no cache key when the upstream is unresolved', () => {
    const graph = makeGraph([makeNode({ id: 'a', status: 'idle' })]);
    expect(classifyRunNode(graph, 'a', undefined)).toEqual({ disposition: 'blocked' });
  });
});
