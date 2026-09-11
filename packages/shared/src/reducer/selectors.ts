import type { Graph, GraphEdge } from '../types';

export function incomingEdges(graph: Graph, nodeId: string): GraphEdge[] {
  return Object.values(graph.edges).filter((edge) => edge.target === nodeId);
}

export function outgoingEdges(graph: Graph, nodeId: string): GraphEdge[] {
  return Object.values(graph.edges).filter((edge) => edge.source === nodeId);
}

export function downstreamOf(graph: Graph, nodeId: string): Set<string> {
  const seen = new Set<string>();
  const queue = outgoingEdges(graph, nodeId).map((edge) => edge.target);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of outgoingEdges(graph, id)) queue.push(edge.target);
  }
  return seen;
}

export function upstreamOf(graph: Graph, nodeId: string): Set<string> {
  const seen = new Set<string>();
  const queue = incomingEdges(graph, nodeId).map((edge) => edge.source);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of incomingEdges(graph, id)) queue.push(edge.source);
  }
  return seen;
}

export function hasFailedAncestor(graph: Graph, nodeId: string): boolean {
  for (const id of upstreamOf(graph, nodeId)) {
    if (graph.nodes[id]?.status === 'failed') return true;
  }
  return false;
}

export class CycleError extends Error {
  constructor(remaining: string[]) {
    super(`Graph has a cycle involving: ${remaining.sort().join(', ')}`);
    this.name = 'CycleError';
  }
}

// Kahn's algorithm. When `targetNodeIds` is given, restricts to those nodes plus all of their
// ancestors (the run orchestrator only ever needs to walk the subgraph ending at its targets).
// Ties broken alphabetically by id for deterministic test output.
export function topoSort(graph: Graph, targetNodeIds?: string[]): string[] {
  const nodeIds = targetNodeIds
    ? new Set<string>([
        ...targetNodeIds,
        ...targetNodeIds.flatMap((id) => [...upstreamOf(graph, id)]),
      ])
    : new Set(Object.keys(graph.nodes));

  const inDegree = new Map<string, number>();
  for (const id of nodeIds) inDegree.set(id, 0);
  for (const edge of Object.values(graph.edges)) {
    if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
  }

  const queue = [...nodeIds].filter((id) => inDegree.get(id) === 0).sort();
  const order: string[] = [];
  const remaining = new Set(nodeIds);

  while (queue.length) {
    queue.sort();
    const id = queue.shift()!;
    order.push(id);
    remaining.delete(id);
    for (const edge of outgoingEdges(graph, id)) {
      if (!nodeIds.has(edge.target)) continue;
      const next = (inDegree.get(edge.target) ?? 0) - 1;
      inDegree.set(edge.target, next);
      if (next === 0) queue.push(edge.target);
    }
  }

  if (order.length !== nodeIds.size) {
    throw new CycleError([...remaining]);
  }
  return order;
}
