import type { Graph } from '@cutgraph/shared';
import type { CutgraphNode } from './types';

// Pure reconciliation: derives the next xyflow node array from the current logical graph,
// preserving every existing flow node's object reference (including its `data` reference)
// unless that node's underlying logical GraphNode reference actually changed since the last
// graph snapshot. This is what lets React.memo on custom node components skip re-rendering
// every node on every dispatch -- only nodes whose status/result/params actually changed get
// a new `data` object.
export function reconcileFlowNodes(
  currentFlowNodes: CutgraphNode[],
  graph: Graph,
  prevGraph: Graph | null,
): CutgraphNode[] {
  const removed = currentFlowNodes.filter((flowNode) => graph.nodes[flowNode.id] !== undefined);

  const byId = new Map(removed.map((flowNode) => [flowNode.id, flowNode]));
  const withAdditions = [...removed];
  for (const [id, logical] of Object.entries(graph.nodes)) {
    if (!byId.has(id)) {
      withAdditions.push({ id, type: logical.type, position: logical.position, data: { node: logical } });
    }
  }

  return withAdditions.map((flowNode) => {
    const logical = graph.nodes[flowNode.id];
    if (!logical) return flowNode; // shouldn't happen (already filtered above), keeps TS happy
    const prevLogical = prevGraph?.nodes[flowNode.id];
    if (prevLogical === logical && flowNode.data.node === logical) return flowNode; // unchanged, skip
    return { ...flowNode, data: { ...flowNode.data, node: logical } };
  });
}
