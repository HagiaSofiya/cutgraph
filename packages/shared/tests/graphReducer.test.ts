import { describe, expect, it } from 'vitest';
import { actions } from '../src/reducer/actions';
import { graphReducer } from '../src/reducer/graphReducer';
import { emptyGraph } from '../src/types';
import { makeEdge, makeGraph, makeNode, makeResult, statusOf } from './helpers';

describe('graphReducer: structural actions', () => {
  it('NODE_ADDED inserts an idle node and is a no-op if the id is already taken', () => {
    const g1 = graphReducer(emptyGraph(), actions.nodeAdded('a', 'trim', { x: 0, y: 0 }, {}));
    expect(statusOf(g1, 'a')).toBe('idle');

    const g2 = graphReducer(g1, actions.nodeAdded('a', 'trim', { x: 99, y: 99 }, {}));
    expect(g2.nodes.a.position).toEqual({ x: 0, y: 0 }); // unchanged, id already used
  });

  it('NODE_REMOVED deletes the node, its incident edges, and marks former downstream targets stale', () => {
    const graph = makeGraph(
      [
        makeNode({ id: 'a', status: 'succeeded', result: makeResult('a') }),
        makeNode({ id: 'b', status: 'succeeded', result: makeResult('b') }),
      ],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' })],
    );

    const next = graphReducer(graph, actions.nodeRemoved('a'));
    expect(next.nodes.a).toBeUndefined();
    expect(next.edges.ab).toBeUndefined();
    expect(statusOf(next, 'b')).toBe('stale');
  });

  it('NODE_MOVED updates position without touching status', () => {
    const graph = makeGraph([makeNode({ id: 'a', status: 'succeeded', result: makeResult('a') })]);
    const next = graphReducer(graph, actions.nodeMoved('a', { x: 10, y: 20 }));
    expect(next.nodes.a.position).toEqual({ x: 10, y: 20 });
    expect(statusOf(next, 'a')).toBe('succeeded');
  });

  it('EDGE_ADDED rejects an edge whose target handle is already taken', () => {
    const graph = makeGraph(
      [makeNode({ id: 'a' }), makeNode({ id: 'b' }), makeNode({ id: 'concat', type: 'concat' })],
      [makeEdge({ id: 'e1', source: 'a', target: 'concat', targetHandle: 'in-0' })],
    );
    const next = graphReducer(
      graph,
      actions.edgeAdded(makeEdge({ id: 'e2', source: 'b', target: 'concat', targetHandle: 'in-0' })),
    );
    expect(next.edges.e2).toBeUndefined(); // rejected, handle in-0 already taken
  });

  it('EDGE_ADDED accepts distinct handles and marks the target stale', () => {
    const graph = makeGraph(
      [
        makeNode({ id: 'a' }),
        makeNode({ id: 'b' }),
        makeNode({ id: 'concat', type: 'concat', status: 'succeeded', result: makeResult('concat') }),
      ],
      [makeEdge({ id: 'e1', source: 'a', target: 'concat', targetHandle: 'in-0' })],
    );
    const next = graphReducer(
      graph,
      actions.edgeAdded(makeEdge({ id: 'e2', source: 'b', target: 'concat', targetHandle: 'in-1' })),
    );
    expect(next.edges.e2).toBeDefined();
    expect(statusOf(next, 'concat')).toBe('stale');
  });

  it('EDGE_REMOVED marks the former target stale', () => {
    const graph = makeGraph(
      [makeNode({ id: 'a' }), makeNode({ id: 'b', status: 'succeeded', result: makeResult('b') })],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' })],
    );
    const next = graphReducer(graph, actions.edgeRemoved('ab'));
    expect(next.edges.ab).toBeUndefined();
    expect(statusOf(next, 'b')).toBe('stale');
  });

  it('PARAM_CHANGED marks the edited node and its downstream chain stale, but leaves an untouched idle node idle', () => {
    const graph = makeGraph(
      [
        makeNode({ id: 'a', status: 'succeeded', result: makeResult('a') }),
        makeNode({ id: 'b', status: 'succeeded', result: makeResult('b') }),
        makeNode({ id: 'c', status: 'idle' }), // never run, unrelated
      ],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' })],
    );
    const next = graphReducer(graph, actions.paramChanged('a', { prompt: 'new' }));
    expect(next.nodes.a.params).toEqual({ prompt: 'new' });
    expect(statusOf(next, 'a')).toBe('stale');
    expect(statusOf(next, 'b')).toBe('stale');
    expect(statusOf(next, 'c')).toBe('idle');
  });

  it('PARAM_CHANGED on a never-run idle node with no result stays idle', () => {
    const graph = makeGraph([makeNode({ id: 'a', status: 'idle' })]);
    const next = graphReducer(graph, actions.paramChanged('a', { prompt: 'x' }));
    expect(statusOf(next, 'a')).toBe('idle');
  });
});

describe('graphReducer: run lifecycle', () => {
  it('NODE_QUEUED applies from idle, stale, and failed, but not from queued/running/succeeded', () => {
    for (const status of ['idle', 'stale', 'failed'] as const) {
      const graph = makeGraph([makeNode({ id: 'a', status })]);
      const next = graphReducer(graph, actions.nodeQueued('a', 'key-1'));
      expect(statusOf(next, 'a')).toBe('queued');
      expect(next.nodes.a.cacheKey).toBe('key-1');
    }
    for (const status of ['queued', 'running', 'succeeded'] as const) {
      const graph = makeGraph([makeNode({ id: 'a', status, cacheKey: 'existing' })]);
      const next = graphReducer(graph, actions.nodeQueued('a', 'key-2'));
      expect(statusOf(next, 'a')).toBe(status); // unchanged
      expect(next.nodes.a.cacheKey).toBe('existing');
    }
  });

  it('NODE_RUNNING applies only from queued with a matching cacheKey', () => {
    const queued = makeGraph([makeNode({ id: 'a', status: 'queued', cacheKey: 'key-1' })]);
    const running = graphReducer(queued, actions.nodeRunning('a', 'key-1', 'job-1'));
    expect(statusOf(running, 'a')).toBe('running');
    expect(running.nodes.a.jobId).toBe('job-1');

    const mismatched = graphReducer(queued, actions.nodeRunning('a', 'key-STALE', 'job-1'));
    expect(statusOf(mismatched, 'a')).toBe('queued'); // rejected: stale cacheKey

    const idle = makeGraph([makeNode({ id: 'a', status: 'idle' })]);
    const noop = graphReducer(idle, actions.nodeRunning('a', 'key-1', 'job-1'));
    expect(statusOf(noop, 'a')).toBe('idle'); // rejected: wrong status
  });

  it('NODE_SUCCEEDED transitions the node when running with a matching key, and always caches the result', () => {
    const graph = makeGraph([makeNode({ id: 'a', status: 'running', cacheKey: 'key-1', jobId: 'job-1' })]);
    const result = makeResult('key-1');
    const next = graphReducer(graph, actions.nodeSucceeded('a', 'key-1', result));

    expect(statusOf(next, 'a')).toBe('succeeded');
    expect(next.nodes.a.result).toEqual(result);
    expect(next.nodes.a.jobId).toBeUndefined();
    expect(next.resultCache['key-1']).toEqual(result);
  });

  it('a superseded NODE_SUCCEEDED (mismatched key, e.g. a param edit landed mid-run) leaves the node untouched but still caches the result', () => {
    const graph = makeGraph([makeNode({ id: 'a', status: 'stale', cacheKey: 'key-1' })]); // was running, PARAM_CHANGED flipped it to stale
    const staleResult = makeResult('key-1');
    const next = graphReducer(graph, actions.nodeSucceeded('a', 'key-1', staleResult));

    expect(statusOf(next, 'a')).toBe('stale'); // never marked succeeded
    expect(next.nodes.a.result).toBeUndefined();
    expect(next.resultCache['key-1']).toEqual(staleResult); // but the work product is not lost
  });

  it('a duplicate NODE_SUCCEEDED delivery for an already-succeeded node is a no-op on the node', () => {
    const result = makeResult('key-1');
    const graph = makeGraph([makeNode({ id: 'a', status: 'succeeded', cacheKey: 'key-1', result })]);
    const next = graphReducer(graph, actions.nodeSucceeded('a', 'key-1', result));
    expect(statusOf(next, 'a')).toBe('succeeded');
    expect(next.nodes.a.result).toEqual(result);
  });

  it('NODE_FAILED applies from queued as well as running (a job can die before it ever starts)', () => {
    const queued = makeGraph([makeNode({ id: 'a', status: 'queued', cacheKey: 'key-1' })]);
    const failedFromQueued = graphReducer(queued, actions.nodeFailed('a', 'key-1', { message: 'boom' }));
    expect(statusOf(failedFromQueued, 'a')).toBe('failed');
    expect(failedFromQueued.nodes.a.error?.message).toBe('boom');

    const running = makeGraph([makeNode({ id: 'a', status: 'running', cacheKey: 'key-1', jobId: 'job-1' })]);
    const failedFromRunning = graphReducer(running, actions.nodeFailed('a', 'key-1', { message: 'boom' }));
    expect(statusOf(failedFromRunning, 'a')).toBe('failed');
    expect(failedFromRunning.nodes.a.jobId).toBeUndefined();
  });

  it('NODE_FAILED retains the prior succeeded result and is rejected on a cacheKey mismatch or a terminal status', () => {
    const priorResult = makeResult('old-key');
    const running = makeGraph([
      makeNode({ id: 'a', status: 'running', cacheKey: 'key-2', result: priorResult }),
    ]);
    const failed = graphReducer(running, actions.nodeFailed('a', 'key-2', { message: 'boom' }));
    expect(statusOf(failed, 'a')).toBe('failed');
    expect(failed.nodes.a.result).toEqual(priorResult); // untouched

    const mismatched = graphReducer(running, actions.nodeFailed('a', 'DIFFERENT', { message: 'boom' }));
    expect(statusOf(mismatched, 'a')).toBe('running'); // rejected, superseded

    const succeeded = makeGraph([makeNode({ id: 'a', status: 'succeeded', cacheKey: 'key-2' })]);
    const noop = graphReducer(succeeded, actions.nodeFailed('a', 'key-2', { message: 'boom' }));
    expect(statusOf(noop, 'a')).toBe('succeeded'); // rejected, wrong status
  });

  it('NODE_RETRY moves a failed node with a retained result to stale, and one with no result to idle', () => {
    const withResult = makeGraph([
      makeNode({ id: 'a', status: 'failed', result: makeResult('old'), error: { message: 'x', at: 1 } }),
    ]);
    const retried = graphReducer(withResult, actions.nodeRetry('a'));
    expect(statusOf(retried, 'a')).toBe('stale');
    expect(retried.nodes.a.error).toBeUndefined();

    const neverRun = makeGraph([makeNode({ id: 'a', status: 'failed', error: { message: 'x', at: 1 } })]);
    const retriedIdle = graphReducer(neverRun, actions.nodeRetry('a'));
    expect(statusOf(retriedIdle, 'a')).toBe('idle');
  });

  it('has no reachable action sequence that wedges a node in queued/running with no path out', () => {
    // Path 1: queued -> failed directly (job never started).
    const a = graphReducer(
      makeGraph([makeNode({ id: 'n', status: 'idle' })]),
      actions.nodeQueued('n', 'k1'),
    );
    const aFailed = graphReducer(a, actions.nodeFailed('n', 'k1', { message: 'network error' }));
    expect(statusOf(aFailed, 'n')).toBe('failed');

    // Path 2: queued -> running -> succeeded.
    const b = graphReducer(a, actions.nodeRunning('n', 'k1', 'job-1'));
    const bSucceeded = graphReducer(b, actions.nodeSucceeded('n', 'k1', makeResult('k1')));
    expect(statusOf(bSucceeded, 'n')).toBe('succeeded');

    // Path 3: refresh-reconciliation pattern -- a node still locally 'queued' because the
    // client never observed a live 'running' event, but the server reports it succeeded.
    // The reconciliation caller sequences RUNNING then the terminal action; a bare terminal
    // action alone (see the dedicated test below) intentionally does NOT apply.
    const c = graphReducer(a, actions.nodeRunning('n', 'k1', 'job-1'));
    const cSucceeded = graphReducer(c, actions.nodeSucceeded('n', 'k1', makeResult('k1')));
    expect(statusOf(cSucceeded, 'n')).toBe('succeeded');
  });

  it('a bare NODE_SUCCEEDED on a still-queued node does not transition it (RUNNING must be sequenced first by the caller)', () => {
    const queued = makeGraph([makeNode({ id: 'a', status: 'queued', cacheKey: 'key-1' })]);
    const next = graphReducer(queued, actions.nodeSucceeded('a', 'key-1', makeResult('key-1')));
    expect(statusOf(next, 'a')).toBe('queued');
    expect(next.resultCache['key-1']).toBeDefined(); // still not thrown away
  });
});

describe('graphReducer: result cache', () => {
  it('caps the result cache and evicts the oldest entries first', () => {
    let graph = makeGraph([]);
    for (let i = 0; i < 205; i++) {
      graph = { ...graph, resultCache: { ...graph.resultCache } };
      graph = graphReducer(
        { ...graph, nodes: { ...graph.nodes, n: makeNode({ id: 'n', status: 'running', cacheKey: `k${i}` }) } },
        actions.nodeSucceeded('n', `k${i}`, makeResult(`k${i}`)),
      );
    }
    const keys = Object.keys(graph.resultCache);
    expect(keys.length).toBe(200);
    expect(graph.resultCache['k0']).toBeUndefined(); // oldest evicted
    expect(graph.resultCache['k204']).toBeDefined(); // newest kept
  });
});

describe('graphReducer: HYDRATE_FROM_STORAGE', () => {
  it('replaces the whole graph wholesale', () => {
    const stored = makeGraph([makeNode({ id: 'z', status: 'idle' })]);
    const next = graphReducer(makeGraph([makeNode({ id: 'a' })]), actions.hydrateFromStorage(stored));
    expect(next.nodes.a).toBeUndefined();
    expect(next.nodes.z).toBeDefined();
  });
});
