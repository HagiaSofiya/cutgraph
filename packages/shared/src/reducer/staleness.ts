import type { Graph, GraphNode, NodeStatus } from '../types';

// A node only becomes 'stale' if it has something worth invalidating: a retained result, or
// an in-flight run. An untouched idle node stays idle -- this keeps 'stale' meaning "was
// correct, now outdated" rather than a generic dirty flag.
export function markStaleIfMeaningful(node: GraphNode): NodeStatus {
  if (node.result !== undefined || node.status === 'queued' || node.status === 'running') {
    return 'stale';
  }
  return node.status;
}

function outgoingTargets(graph: Graph, nodeId: string): string[] {
  const targets: string[] = [];
  for (const edge of Object.values(graph.edges)) {
    if (edge.source === nodeId) targets.push(edge.target);
  }
  return targets;
}

// BFS-propagate staleness downstream from `startIds` (inclusive). Used for PARAM_CHANGED
// (start = the edited node itself), EDGE_ADDED/EDGE_REMOVED (start = the edge's target -- the
// source node's own output didn't change), and NODE_REMOVED (start = the removed node's
// former downstream targets, computed before deletion).
export function propagateStale(graph: Graph, startIds: string[]): Graph {
  const nodes = { ...graph.nodes };
  const queue = [...startIds];
  const seen = new Set<string>();

  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || !nodes[id]) continue;
    seen.add(id);
    const node = nodes[id];
    const nextStatus = markStaleIfMeaningful(node);
    if (nextStatus !== node.status) {
      nodes[id] = { ...node, status: nextStatus, updatedAt: Date.now() };
    }
    for (const target of outgoingTargets(graph, id)) queue.push(target);
  }

  return { ...graph, nodes };
}
