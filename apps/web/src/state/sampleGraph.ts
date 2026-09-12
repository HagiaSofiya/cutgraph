import { actions, emptyGraph, graphReducer } from '@cutgraph/shared';
import type { Graph, GraphAction, GraphEdge } from '@cutgraph/shared';

// The pipeline from the README screenshot: one Text to Image fanning out into two Image to
// Video branches, concatenated and exported. Nodes ship idle with real prompts rather than
// pre-baked results -- fixtures/ is gitignored and regenerated and the API base varies by
// environment, so a baked-in result URL would rot, and Run (the thing worth watching) would
// become a no-op.
const NODES = [
  {
    key: 't2i',
    type: 'textToImage',
    position: { x: 40, y: 200 },
    params: { prompt: 'a neon-lit alley in the rain, cinematic wide shot', ratio: '16:9' },
  },
  {
    key: 'i2v-a',
    type: 'imageToVideo',
    position: { x: 340, y: 40 },
    params: { prompt: 'slow dolly push down the alley', duration: 4, ratio: '16:9' },
  },
  {
    key: 'i2v-b',
    type: 'imageToVideo',
    position: { x: 340, y: 340 },
    // Deliberately different from the other branch: the fixture adapter picks a clip by hashing
    // the params, so distinct prompts make the Concat result visibly a join of two clips.
    params: { prompt: 'handheld pan across the puddles, reflections rippling', duration: 4, ratio: '16:9' },
  },
  { key: 'concat', type: 'concat', position: { x: 660, y: 190 }, params: {} },
  { key: 'export', type: 'export', position: { x: 960, y: 190 }, params: { filename: 'cutgraph-sample.mp4' } },
] as const;

// Source handles are unnamed (see NodeShell), so sourceHandle is always null. Concat's two
// inputs must land on distinct target handles -- the reducer rejects an edge into an occupied
// one, and the run orchestrator orders Concat's inputs by handle.
const EDGES = [
  { source: 't2i', target: 'i2v-a', targetHandle: null },
  { source: 't2i', target: 'i2v-b', targetHandle: null },
  { source: 'i2v-a', target: 'concat', targetHandle: 'in-0' },
  { source: 'i2v-b', target: 'concat', targetHandle: 'in-1' },
  { source: 'concat', target: 'export', targetHandle: null },
] as const;

export function createSampleGraph(): Graph {
  // Fresh ids per call: reconcileFlowNodes only applies `position` to flow nodes it hasn't seen
  // before, so reusing fixed ids would leave a re-loaded sample sitting wherever the user had
  // dragged the previous one.
  const suffix = crypto.randomUUID().slice(0, 8);
  const idOf = (key: string) => `sample-${key}-${suffix}`;

  const nodeActions: GraphAction[] = NODES.map((node) =>
    actions.nodeAdded(idOf(node.key), node.type, node.position, node.params),
  );

  const edgeActions: GraphAction[] = EDGES.map(({ source, target, targetHandle }) => {
    const edge: GraphEdge = {
      // Same id format FlowCanvas builds when the user draws a connection by hand.
      id: `${idOf(source)}:out->${idOf(target)}:${targetHandle ?? 'in'}`,
      source: idOf(source),
      sourceHandle: null,
      target: idOf(target),
      targetHandle,
    };
    return actions.edgeAdded(edge);
  });

  // Folding the real reducer over real actions rather than hand-writing GraphNode records: the
  // sample is then valid by construction (status, updatedAt, edge preconditions and all).
  return [...nodeActions, ...edgeActions].reduce(graphReducer, emptyGraph());
}
