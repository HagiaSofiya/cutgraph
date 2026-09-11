import { GraphSchema } from '@cutgraph/shared';
import type { Graph, GraphNode, MediaRef } from '@cutgraph/shared';

const STORAGE_KEY = 'cutgraph:graph:v1';

// A node's run can only be reconciled after a reload if the backend has a job to poll --
// i.e. it has a jobId. Anything queued/running with no jobId (a client-side op interrupted
// mid-flight, or a generation POST that never completed) cannot be resumed and is coerced
// back to a stable status instead. Ephemeral results (Trim/Concat/Export blob: URLs) can
// never survive a reload either way, since the bytes never left the tab.
export function sanitizeNodeForStorage(node: GraphNode): GraphNode {
  const hasEphemeralResult = node.result?.durability === 'ephemeral';
  const unreconcilableRun = (node.status === 'queued' || node.status === 'running') && node.jobId === undefined;

  if (!hasEphemeralResult && !unreconcilableRun) return node;

  const survivingResult = hasEphemeralResult ? undefined : node.result;

  // Matches the reducer's own markStaleIfMeaningful: an interrupted queued/running node is
  // always "meaningful" enough to flag as stale, and so is a 'succeeded' node whose only
  // evidence just got stripped. A 'failed' node keeps its more specific status (and error
  // message) rather than being flattened to generic staleness; an already-'stale' node is
  // already the right status.
  const status = unreconcilableRun || node.status === 'succeeded' ? 'stale' : node.status;

  return {
    ...node,
    result: survivingResult,
    cacheKey: survivingResult ? node.cacheKey : undefined,
    jobId: undefined,
    status,
  };
}

export function sanitizeGraphForStorage(graph: Graph): Graph {
  const nodes: Record<string, GraphNode> = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    nodes[id] = sanitizeNodeForStorage(node);
  }

  const resultCache: Record<string, MediaRef> = {};
  for (const [key, ref] of Object.entries(graph.resultCache)) {
    if (ref.durability === 'persistent') resultCache[key] = ref;
  }

  return { ...graph, nodes, resultCache };
}

export function saveGraph(graph: Graph): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeGraphForStorage(graph)));
  } catch {
    // Persistence is a convenience, not load-bearing within a single session -- quota errors
    // and private-browsing restrictions shouldn't break the app.
  }
}

export function loadGraph(): Graph | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = GraphSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data as unknown as Graph) : undefined;
  } catch {
    return undefined;
  }
}

export function clearStoredGraph(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
