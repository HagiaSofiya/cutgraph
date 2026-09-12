import { actions, graphReducer } from '@cutgraph/shared';
import type { MediaRef, NodeType } from '@cutgraph/shared';
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

function everyNodeType(executor: Executor): Record<NodeType, Executor> {
  return {
    imageInput: executor,
    textToImage: executor,
    imageToVideo: executor,
    trim: executor,
    concat: executor,
    export: executor,
  };
}

// Lets a test drain the microtask queue and then assert on what has *started* while nothing has
// been allowed to finish -- the only way to tell concurrent execution from sequential execution.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferredExecutor() {
  const started: string[] = [];
  const resolvers = new Map<string, (result: MediaRef) => void>();
  const executor: Executor = {
    run: (ctx) =>
      new Promise<MediaRef>((resolve) => {
        started.push(ctx.node.id);
        ctx.dispatch(actions.nodeRunning(ctx.node.id, ctx.cacheKey));
        resolvers.set(ctx.node.id, resolve);
      }),
  };
  return { executor, started, finish: (id: string) => resolvers.get(id)!(makeResult(`r-${id}`)) };
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
  it('runs independent branches concurrently, and starts their join only once both have settled', async () => {
    // The sample pipeline's shape: one already-succeeded source fanning out into two legs that
    // both feed a concat.
    const graph = makeGraph(
      [
        makeNode({ id: 'src', type: 'textToImage', status: 'succeeded', result: makeResult('r-src'), cacheKey: 'r-src' }),
        makeNode({ id: 'a', type: 'imageToVideo', params: { prompt: 'dolly', duration: 4, ratio: '16:9' } }),
        makeNode({ id: 'b', type: 'imageToVideo', params: { prompt: 'pan', duration: 4, ratio: '16:9' } }),
        makeNode({ id: 'concat', type: 'concat' }),
      ],
      [
        makeEdge({ id: 'sa', source: 'src', target: 'a' }),
        makeEdge({ id: 'sb', source: 'src', target: 'b' }),
        makeEdge({ id: 'ac', source: 'a', target: 'concat', targetHandle: 'in-0' }),
        makeEdge({ id: 'bc', source: 'b', target: 'concat', targetHandle: 'in-1' }),
      ],
    );

    const { executor, started, finish } = deferredExecutor();
    const harness = createHarness(graph);
    const run = createRunGraph();
    const runPromise = run(['concat'], {
      getGraph: harness.getGraph,
      dispatch: harness.dispatch,
      executors: everyNodeType(executor),
    });

    await flush();
    // Sequentially only 'a' would have started: 'b' would still be waiting for it to finish.
    expect(started).toEqual(['a', 'b']);
    expect(harness.getGraph().nodes.a.status).toBe('running');
    expect(harness.getGraph().nodes.b.status).toBe('running');

    finish('a');
    await flush();
    expect(started).toEqual(['a', 'b']); // concat still blocked on the other leg

    finish('b');
    await flush();
    expect(started).toEqual(['a', 'b', 'concat']);

    finish('concat');
    await runPromise;
    expect(harness.getGraph().nodes.concat.status).toBe('succeeded');
  });

  it('never runs more nodes at once than maxConcurrency', async () => {
    const ids = ['n1', 'n2', 'n3', 'n4'];
    const graph = makeGraph(
      // Distinct params so no two share a cache key -- this is a test about slots, nothing else.
      ids.map((id, i) => makeNode({ id, type: 'trim', params: { start: i, end: i + 1 } })),
    );

    let active = 0;
    let peak = 0;
    const pending: Array<() => void> = [];
    const executor: Executor = {
      run: (ctx) =>
        new Promise<MediaRef>((resolve) => {
          active += 1;
          peak = Math.max(peak, active);
          ctx.dispatch(actions.nodeRunning(ctx.node.id, ctx.cacheKey));
          pending.push(() => {
            active -= 1;
            resolve(makeResult(`r-${ctx.node.id}`));
          });
        }),
    };

    const harness = createHarness(graph);
    const run = createRunGraph();
    const runPromise = run(ids, {
      getGraph: harness.getGraph,
      dispatch: harness.dispatch,
      executors: everyNodeType(executor),
      maxConcurrency: 2,
    });

    await flush();
    expect(active).toBe(2); // the other two are queued, waiting for a slot
    expect(harness.getGraph().nodes.n3.status).toBe('queued');

    while (pending.length) {
      pending.shift()!();
      await flush();
    }
    await runPromise;

    expect(peak).toBe(2);
    for (const id of ids) expect(harness.getGraph().nodes[id].status).toBe('succeeded');
  });

  it('two generation nodes sharing a cache key generate once and share the result', async () => {
    // Same type, same params, same upstream output => byte-identical cache keys. Sequentially
    // the second was a free cache hit; concurrently it must join the first rather than pay again.
    const params = { prompt: 'the same prompt', duration: 4, ratio: '16:9' };
    const graph = makeGraph(
      [
        makeNode({ id: 'src', type: 'textToImage', status: 'succeeded', result: makeResult('r-src'), cacheKey: 'r-src' }),
        makeNode({ id: 'x', type: 'imageToVideo', params }),
        makeNode({ id: 'y', type: 'imageToVideo', params }),
      ],
      [makeEdge({ id: 'sx', source: 'src', target: 'x' }), makeEdge({ id: 'sy', source: 'src', target: 'y' })],
    );

    const { executor, calls } = makeExecutor({ ok: true, result: makeResult('r-shared') });
    const harness = createHarness(graph);
    const run = createRunGraph();
    await run(['x', 'y'], {
      getGraph: harness.getGraph,
      dispatch: harness.dispatch,
      executors: everyNodeType(executor),
    });

    expect(calls).toHaveLength(1); // one generation, not two
    const finalGraph = harness.getGraph();
    expect(finalGraph.nodes.x.status).toBe('succeeded');
    expect(finalGraph.nodes.y.status).toBe('succeeded');
    expect(finalGraph.nodes.y.result?.id).toBe(finalGraph.nodes.x.result?.id);
  });

  it('preserves a failure code carried on the rejection, and omits one when absent', async () => {
    const graph = makeGraph([makeNode({ id: 'coded', type: 'trim', params: { start: 0, end: 1 } }), makeNode({ id: 'plain', type: 'trim', params: { start: 1, end: 2 } })]);
    const executor: Executor = {
      async run(ctx) {
        ctx.dispatch(actions.nodeRunning(ctx.node.id, ctx.cacheKey));
        if (ctx.node.id === 'coded') {
          // Shape an ApiError carries: a message plus a recognized code.
          throw Object.assign(new Error('generation limit reached'), { code: 'SPEND_LIMIT' });
        }
        throw new Error('a plain local failure');
      },
    };

    const harness = createHarness(graph);
    const run = createRunGraph();
    await run(['coded', 'plain'], {
      getGraph: harness.getGraph,
      dispatch: harness.dispatch,
      executors: everyNodeType(executor),
    });

    const finalGraph = harness.getGraph();
    expect(finalGraph.nodes.coded.error?.code).toBe('SPEND_LIMIT');
    expect(finalGraph.nodes.plain.error?.code).toBeUndefined();
    expect(finalGraph.nodes.plain.error?.message).toBe('a plain local failure');
  });
});
