import { actions, graphReducer } from '@cutgraph/shared';
import { describe, expect, it } from 'vitest';
import type { Executor, ExecutorContext } from '../src/orchestrator/executors/types';
import { createRunGraph, retryNode, terminalNodeIds } from '../src/orchestrator/runGraph';
import { makeEdge, makeGraph, makeNode, makeResult } from './helpers';

function makeExecutor(outcome: { ok: true; result: ReturnType<typeof makeResult> } | { ok: false; error: string }) {
  const calls: ExecutorContext[] = [];
  const executor: Executor = {
    async run(ctx) {
      calls.push(ctx);
      ctx.dispatch(actions.nodeRunning(ctx.node.id, ctx.cacheKey));
      if (!outcome.ok) throw new Error(outcome.error);
      return outcome.result;
    },
  };
  return { executor, calls };
}

function createHarness(initialGraph: ReturnType<typeof makeGraph>) {
  let graph = initialGraph;
  const dispatch = (action: Parameters<typeof graphReducer>[1]) => {
    graph = graphReducer(graph, action);
  };
  return { getGraph: () => graph, dispatch };
}

describe('runGraph', () => {
  it('executes a linear graph in topological order', async () => {
    const graph = makeGraph(
      [
        makeNode({ id: 'a', type: 'imageInput' }),
        makeNode({ id: 'b', type: 'imageToVideo' }),
        makeNode({ id: 'c', type: 'trim' }),
      ],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' }), makeEdge({ id: 'bc', source: 'b', target: 'c' })],
    );

    const order: string[] = [];
    const trackingExecutor = (id: string) => (result: ReturnType<typeof makeResult>): Executor => ({
      async run(ctx) {
        order.push(id);
        ctx.dispatch(actions.nodeRunning(ctx.node.id, ctx.cacheKey));
        return result;
      },
    });

    const harness = createHarness(graph);
    const run = createRunGraph();
    await run(terminalNodeIds(graph), {
      getGraph: harness.getGraph,
      dispatch: harness.dispatch,
      executors: {
        imageInput: trackingExecutor('a')(makeResult('r-a')),
        textToImage: trackingExecutor('unused')(makeResult('unused')),
        imageToVideo: trackingExecutor('b')(makeResult('r-b')),
        trim: trackingExecutor('c')(makeResult('r-c')),
        concat: trackingExecutor('unused')(makeResult('unused')),
        export: trackingExecutor('unused')(makeResult('unused')),
      },
    });

    expect(order).toEqual(['a', 'b', 'c']);
    expect(harness.getGraph().nodes.a.status).toBe('succeeded');
    expect(harness.getGraph().nodes.b.status).toBe('succeeded');
    expect(harness.getGraph().nodes.c.status).toBe('succeeded');
  });

  it('skips execution on a cache hit and dispatches the cached result directly', async () => {
    const graph = makeGraph([makeNode({ id: 'a', type: 'textToImage', params: { prompt: 'a cat', ratio: '1:1' } })]);
    const cached = makeResult('cache-hit-key');
    // Precompute the exact key runGraph will derive for this node (no upstream, these params).
    const { deriveCacheKey } = await import('@cutgraph/shared');
    const key = deriveCacheKey({ nodeType: 'textToImage', params: { prompt: 'a cat', ratio: '1:1' }, upstream: [] });
    graph.resultCache[key] = { ...cached, id: key };

    const { executor, calls } = makeExecutor({ ok: true, result: makeResult('should-not-be-used') });
    const harness = createHarness(graph);
    const run = createRunGraph();
    await run(['a'], {
      getGraph: harness.getGraph,
      dispatch: harness.dispatch,
      executors: {
        imageInput: executor,
        textToImage: executor,
        imageToVideo: executor,
        trim: executor,
        concat: executor,
        export: executor,
      },
    });

    expect(calls).toHaveLength(0); // never executed
    const node = harness.getGraph().nodes.a;
    expect(node.status).toBe('succeeded');
    expect(node.result?.id).toBe(key);
  });

  it('isolates a failed branch: an independent branch still succeeds, and the failed node blocks only its own downstream', async () => {
    // a (fails) -> b (blocked)
    // c (independent, succeeds)
    const graph = makeGraph(
      [
        makeNode({ id: 'a', type: 'imageInput' }),
        makeNode({ id: 'b', type: 'trim' }),
        makeNode({ id: 'c', type: 'imageInput' }),
      ],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' })],
    );

    const failingA = makeExecutor({ ok: false, error: 'upload failed' });
    const succeedingC = makeExecutor({ ok: true, result: makeResult('r-c') });
    const shouldNotRun = makeExecutor({ ok: true, result: makeResult('should-not-run') });

    const harness = createHarness(graph);
    const run = createRunGraph();
    await run(['b', 'c'], {
      getGraph: harness.getGraph,
      dispatch: harness.dispatch,
      executors: {
        imageInput: { async run(ctx) {
          if (ctx.node.id === 'a') return failingA.executor.run(ctx);
          return succeedingC.executor.run(ctx);
        } },
        textToImage: shouldNotRun.executor,
        imageToVideo: shouldNotRun.executor,
        trim: shouldNotRun.executor, // 'b' must never reach this -- it's blocked by 'a'
        concat: shouldNotRun.executor,
        export: shouldNotRun.executor,
      },
    });

    const finalGraph = harness.getGraph();
    expect(finalGraph.nodes.a.status).toBe('failed');
    expect(finalGraph.nodes.b.status).toBe('idle'); // blocked, never attempted
    expect(finalGraph.nodes.c.status).toBe('succeeded');
    expect(shouldNotRun.calls).toHaveLength(0);
  });

  it('retry re-runs only the failed node and does not cascade to its stale descendants', async () => {
    // a (succeeded) -> b (failed) -> c (stale, has a retained result from before)
    const graph = makeGraph(
      [
        makeNode({ id: 'a', type: 'imageInput', status: 'succeeded', result: makeResult('r-a'), cacheKey: 'r-a' }),
        makeNode({ id: 'b', type: 'imageToVideo', status: 'failed', error: { message: 'boom', at: 1 } }),
        makeNode({ id: 'c', type: 'trim', status: 'stale', result: makeResult('old-c'), cacheKey: 'old-c' }),
      ],
      [makeEdge({ id: 'ab', source: 'a', target: 'b' }), makeEdge({ id: 'bc', source: 'b', target: 'c' })],
    );

    const { executor: bExecutor, calls: bCalls } = makeExecutor({ ok: true, result: makeResult('r-b') });
    const { executor: cExecutor, calls: cCalls } = makeExecutor({ ok: true, result: makeResult('r-c') });

    const harness = createHarness(graph);
    const run = createRunGraph();
    await retryNode(
      'b',
      {
        getGraph: harness.getGraph,
        dispatch: harness.dispatch,
        executors: {
          imageInput: cExecutor,
          textToImage: cExecutor,
          imageToVideo: bExecutor,
          trim: cExecutor,
          concat: cExecutor,
          export: cExecutor,
        },
      },
      run,
    );

    expect(bCalls).toHaveLength(1);
    expect(cCalls).toHaveLength(0); // retry does not cascade forward

    const finalGraph = harness.getGraph();
    expect(finalGraph.nodes.b.status).toBe('succeeded');
    expect(finalGraph.nodes.c.status).toBe('stale'); // untouched, still stale, result retained
    expect(finalGraph.nodes.c.result?.id).toBe('old-c');
  });

  it('a second concurrent call is a no-op while a run is already in flight', async () => {
    const graph = makeGraph([makeNode({ id: 'a', type: 'imageInput' })]);
    let resolveRun: (() => void) | undefined;
    const slowExecutor: Executor = {
      run: (ctx) =>
        new Promise((resolve) => {
          ctx.dispatch(actions.nodeRunning(ctx.node.id, ctx.cacheKey));
          resolveRun = () => resolve(makeResult('r-a'));
        }),
    };

    const harness = createHarness(graph);
    const run = createRunGraph();
    const deps = {
      getGraph: harness.getGraph,
      dispatch: harness.dispatch,
      executors: {
        imageInput: slowExecutor,
        textToImage: slowExecutor,
        imageToVideo: slowExecutor,
        trim: slowExecutor,
        concat: slowExecutor,
        export: slowExecutor,
      },
    };

    const firstRun = run(['a'], deps);
    const secondRun = run(['a'], deps); // should return immediately, no-op

    await secondRun;
    expect(harness.getGraph().nodes.a.status).toBe('running'); // first run still in flight

    resolveRun?.();
    await firstRun;
    expect(harness.getGraph().nodes.a.status).toBe('succeeded');
  });
});
