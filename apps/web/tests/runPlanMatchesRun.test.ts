import { actions, graphReducer, selectRunPlan } from '@cutgraph/shared';
import type { Graph, NodeType } from '@cutgraph/shared';
import { describe, expect, it } from 'vitest';
import type { Executor, ExecutorContext } from '../src/orchestrator/executors/types';
import { createRunGraph, terminalNodeIds } from '../src/orchestrator/runGraph';
import { makeEdge, makeGraph, makeNode, makeResult } from './helpers';

// Returns the cacheKey it was handed as the result id, which is the MediaRef.id === cacheKey
// invariant every real executor upholds -- and the one selectRunPlan's transitive prediction
// rests on. A recording executor lets a test compare what the plan said against what ran.
function recordingExecutor() {
  const calls: ExecutorContext[] = [];
  const executor: Executor = {
    async run(ctx) {
      calls.push(ctx);
      ctx.dispatch(actions.nodeRunning(ctx.node.id, ctx.cacheKey));
      return makeResult(ctx.cacheKey);
    },
  };
  const byNodeType: Record<NodeType, Executor> = {
    imageInput: executor,
    textToImage: executor,
    imageToVideo: executor,
    trim: executor,
    concat: executor,
    export: executor,
  };
  return { byNodeType, calls };
}

function createHarness(initialGraph: Graph) {
  let graph = initialGraph;
  return {
    getGraph: () => graph,
    dispatch: (action: Parameters<typeof graphReducer>[1]) => {
      graph = graphReducer(graph, action);
    },
  };
}

describe('selectRunPlan agrees with the run it describes', () => {
  it('predicts exactly which nodes execute, and with which cache keys', async () => {
    // A diamond with one leg already succeeded, so the plan has to get all three dispositions
    // right at once: settled, execute, and execute-downstream-of-a-prediction.
    const graph = makeGraph(
      [
        makeNode({ id: 'src', type: 'textToImage', params: { prompt: 'a cat' } }),
        makeNode({ id: 'left', type: 'imageToVideo', params: { prompt: 'pan left' } }),
        makeNode({ id: 'right', type: 'imageToVideo', params: { prompt: 'pan right' } }),
        makeNode({ id: 'join', type: 'concat', params: {} }),
        makeNode({ id: 'out', type: 'export', params: { filename: 'x.mp4' } }),
      ],
      [
        makeEdge({ id: 'e1', source: 'src', target: 'left', targetHandle: 'in' }),
        makeEdge({ id: 'e2', source: 'src', target: 'right', targetHandle: 'in' }),
        makeEdge({ id: 'e3', source: 'left', target: 'join', targetHandle: 'a' }),
        makeEdge({ id: 'e4', source: 'right', target: 'join', targetHandle: 'b' }),
        makeEdge({ id: 'e5', source: 'join', target: 'out', targetHandle: 'in' }),
      ],
    );

    const plan = selectRunPlan(graph, terminalNodeIds(graph));
    const predicted = new Map(
      plan.entries.filter((e) => e.disposition === 'execute').map((e) => [e.nodeId, e.cacheKey]),
    );
    expect(plan.generations).toBe(3);
    expect(plan.clientSide).toBe(2);

    const { byNodeType, calls } = recordingExecutor();
    const harness = createHarness(graph);
    await createRunGraph()(terminalNodeIds(graph), { ...harness, executors: byNodeType });

    expect(new Set(calls.map((c) => c.node.id))).toEqual(new Set(predicted.keys()));
    for (const call of calls) {
      expect(call.cacheKey).toBe(predicted.get(call.node.id));
    }
  });

  it('counts a joined pair of identical generation nodes as the one adapter call it becomes', async () => {
    const graph = makeGraph([
      makeNode({ id: 'a', type: 'textToImage', params: { prompt: 'same' } }),
      makeNode({ id: 'b', type: 'textToImage', params: { prompt: 'same' } }),
    ]);

    const plan = selectRunPlan(graph, terminalNodeIds(graph));
    expect(plan.generations).toBe(1);

    const { byNodeType, calls } = recordingExecutor();
    const harness = createHarness(graph);
    await createRunGraph()(terminalNodeIds(graph), { ...harness, executors: byNodeType });

    expect(calls).toHaveLength(1);
    expect(harness.getGraph().nodes.a.status).toBe('succeeded');
    expect(harness.getGraph().nodes.b.status).toBe('succeeded');
  });

  it('predicts a cache hit that the run then takes without calling an executor', async () => {
    const graph = makeGraph([makeNode({ id: 'a', type: 'textToImage', params: { prompt: 'p' } })]);
    const firstPlan = selectRunPlan(graph, ['a']);
    const key = firstPlan.entries[0].cacheKey!;
    graph.resultCache[key] = makeResult(key);

    const plan = selectRunPlan(graph, ['a']);
    expect(plan.cached).toBe(1);
    expect(plan.generations).toBe(0);

    const { byNodeType, calls } = recordingExecutor();
    const harness = createHarness(graph);
    await createRunGraph()(['a'], { ...harness, executors: byNodeType });

    expect(calls).toHaveLength(0);
    expect(harness.getGraph().nodes.a.status).toBe('succeeded');
  });
});
