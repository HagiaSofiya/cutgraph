import type { Graph, GraphEdge, GraphNode, MediaRef, NodeType } from '@cutgraph/shared';

let counter = 0;
function nextTs(): number {
  counter += 1;
  return counter;
}

export function makeNode(overrides: Partial<GraphNode> & { id: string; type?: NodeType }): GraphNode {
  return {
    id: overrides.id,
    type: overrides.type ?? 'trim',
    position: overrides.position ?? { x: 0, y: 0 },
    params: overrides.params ?? {},
    status: overrides.status ?? 'idle',
    result: overrides.result,
    cacheKey: overrides.cacheKey,
    error: overrides.error,
    jobId: overrides.jobId,
    updatedAt: overrides.updatedAt ?? nextTs(),
  };
}

export function makeEdge(
  overrides: Partial<GraphEdge> & { id: string; source: string; target: string },
): GraphEdge {
  return {
    id: overrides.id,
    source: overrides.source,
    sourceHandle: overrides.sourceHandle ?? null,
    target: overrides.target,
    targetHandle: overrides.targetHandle ?? null,
  };
}

export function makeGraph(nodes: GraphNode[], edges: GraphEdge[] = []): Graph {
  return {
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    edges: Object.fromEntries(edges.map((e) => [e.id, e])),
    resultCache: {},
  };
}

export function makeResult(id: string, overrides: Partial<MediaRef> = {}): MediaRef {
  return {
    id,
    kind: 'video',
    url: `https://example.test/${id}`,
    durability: 'persistent',
    ...overrides,
  };
}
