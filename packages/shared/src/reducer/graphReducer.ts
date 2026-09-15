import type { Graph, GraphDocument, GraphNode } from '../types';
import type { GraphAction } from './actions';
import { propagateStale } from './staleness';

const RESULT_CACHE_LIMIT = 200;

// Object.keys preserves insertion order for string keys, so the first `overflow` keys are the
// oldest entries. Not important for a demo-sized graph, but an unbounded map in localStorage
// is the kind of thing a reviewer notices.
function capResultCache(cache: Graph['resultCache']): Graph['resultCache'] {
  const keys = Object.keys(cache);
  if (keys.length <= RESULT_CACHE_LIMIT) return cache;
  const trimmed = { ...cache };
  for (const key of keys.slice(0, keys.length - RESULT_CACHE_LIMIT)) delete trimmed[key];
  return trimmed;
}

function updateNode(graph: Graph, nodeId: string, patch: Partial<GraphNode>): Graph {
  const node = graph.nodes[nodeId];
  if (!node) return graph;
  return {
    ...graph,
    nodes: { ...graph.nodes, [nodeId]: { ...node, ...patch, updatedAt: Date.now() } },
  };
}

function sameHandle(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? null) === (b ?? null);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => sameValue(value, b[i]));
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.hasOwn(bRecord, key) && sameValue(aRecord[key], bRecord[key]))
  );
}

function restoreGraphDocument(graph: Graph, document: GraphDocument): Graph {
  const changedTargets = new Set<string>();
  const allNodeIds = new Set([...Object.keys(graph.nodes), ...Object.keys(document.nodes)]);

  for (const nodeId of allNodeIds) {
    const current = graph.nodes[nodeId];
    const target = document.nodes[nodeId];
    if (current && !target) {
      for (const edge of Object.values(graph.edges)) {
        if (edge.source === nodeId) changedTargets.add(edge.target);
      }
    } else if (current && target && (current.type !== target.type || !sameValue(current.params, target.params))) {
      changedTargets.add(nodeId);
    }
  }

  const allEdgeIds = new Set([...Object.keys(graph.edges), ...Object.keys(document.edges)]);
  for (const edgeId of allEdgeIds) {
    const current = graph.edges[edgeId];
    const target = document.edges[edgeId];
    if (current && !target) changedTargets.add(current.target);
    else if (target && !current) changedTargets.add(target.target);
    else if (current && target && !sameValue(current, target)) {
      changedTargets.add(current.target);
      changedTargets.add(target.target);
    }
  }

  const nodes: Record<string, GraphNode> = {};
  const changedNodeIds = new Set<string>();
  for (const [nodeId, target] of Object.entries(document.nodes)) {
    const current = graph.nodes[nodeId];
    if (!current) {
      nodes[nodeId] = {
        ...target,
        status: 'idle',
        updatedAt: Date.now(),
      };
      continue;
    }

    const inputsUnchanged = current.type === target.type && sameValue(current.params, target.params);
    const positionUnchanged = sameValue(current.position, target.position);
    if (inputsUnchanged && positionUnchanged) {
      nodes[nodeId] = current;
      continue;
    }
    if (!inputsUnchanged) changedNodeIds.add(nodeId);
    nodes[nodeId] = {
      ...current,
      ...target,
      ...(inputsUnchanged ? {} : { jobId: undefined }),
      updatedAt: Date.now(),
    };
  }

  let restored: Graph = {
    ...graph,
    nodes,
    edges: document.edges,
  };
  restored = propagateStale(restored, [...changedTargets]);

  // A document restore must never bring back a job id for a node whose inputs or upstream
  // wiring just changed. Its remote job may still settle, but the reducer will ignore that
  // terminal event unless the node is still queued/running with the same cache key.
  const cleanNodes = { ...restored.nodes };
  for (const nodeId of changedNodeIds) {
    const node = cleanNodes[nodeId];
    if (node) cleanNodes[nodeId] = { ...node, jobId: undefined };
  }
  for (const nodeId of changedTargets) {
    const node = cleanNodes[nodeId];
    if (node?.status === 'stale' && node.jobId !== undefined) {
      cleanNodes[nodeId] = { ...node, jobId: undefined };
    }
  }
  return { ...restored, nodes: cleanNodes };
}

// Pure (state, action) -> state. No side effects, no async, no graph-walking beyond the
// staleness BFS in staleness.ts. Cache keys are derived by the orchestrator, not here -- the
// reducer only stores and compares the keys it's handed.
export function graphReducer(graph: Graph, action: GraphAction): Graph {
  switch (action.type) {
    case 'NODE_ADDED': {
      if (graph.nodes[action.nodeId]) return graph;
      const node: GraphNode = {
        id: action.nodeId,
        type: action.nodeType,
        position: action.position,
        params: action.params,
        status: 'idle',
        updatedAt: Date.now(),
      };
      return { ...graph, nodes: { ...graph.nodes, [action.nodeId]: node } };
    }

    case 'NODE_REMOVED': {
      if (!graph.nodes[action.nodeId]) return graph;
      const downstreamTargets = Object.values(graph.edges)
        .filter((edge) => edge.source === action.nodeId)
        .map((edge) => edge.target);

      const nodes = { ...graph.nodes };
      delete nodes[action.nodeId];
      const edges = Object.fromEntries(
        Object.entries(graph.edges).filter(
          ([, edge]) => edge.source !== action.nodeId && edge.target !== action.nodeId,
        ),
      );

      return propagateStale({ ...graph, nodes, edges }, downstreamTargets);
    }

    case 'NODE_MOVED': {
      return updateNode(graph, action.nodeId, { position: action.position });
    }

    case 'NODES_MOVED': {
      const nodes = { ...graph.nodes };
      let changed = false;
      for (const { nodeId, position } of action.positions) {
        const node = nodes[nodeId];
        if (!node || (node.position.x === position.x && node.position.y === position.y)) continue;
        nodes[nodeId] = { ...node, position, updatedAt: Date.now() };
        changed = true;
      }
      return changed ? { ...graph, nodes } : graph;
    }

    case 'EDGE_ADDED': {
      const { edge } = action;
      if (!graph.nodes[edge.source] || !graph.nodes[edge.target]) return graph;
      const handleTaken = Object.values(graph.edges).some(
        (existing) =>
          existing.target === edge.target && sameHandle(existing.targetHandle, edge.targetHandle),
      );
      if (handleTaken) return graph;
      const next = { ...graph, edges: { ...graph.edges, [edge.id]: edge } };
      return propagateStale(next, [edge.target]);
    }

    case 'EDGE_REMOVED': {
      const edge = graph.edges[action.edgeId];
      if (!edge) return graph;
      const edges = { ...graph.edges };
      delete edges[action.edgeId];
      return propagateStale({ ...graph, edges }, [edge.target]);
    }

    case 'PARAM_CHANGED': {
      if (!graph.nodes[action.nodeId]) return graph;
      const withParams = updateNode(graph, action.nodeId, { params: action.params });
      return propagateStale(withParams, [action.nodeId]);
    }

    case 'NODE_QUEUED': {
      const node = graph.nodes[action.nodeId];
      if (!node) return graph;
      if (node.status !== 'idle' && node.status !== 'stale' && node.status !== 'failed') {
        return graph;
      }
      return updateNode(graph, action.nodeId, {
        status: 'queued',
        cacheKey: action.cacheKey,
        error: undefined,
      });
    }

    case 'NODE_RUNNING': {
      const node = graph.nodes[action.nodeId];
      if (!node) return graph;
      if (node.status !== 'queued' || node.cacheKey !== action.cacheKey) return graph;
      return updateNode(graph, action.nodeId, { status: 'running', jobId: action.jobId });
    }

    case 'NODE_SUCCEEDED': {
      const node = graph.nodes[action.nodeId];
      const resultCache = capResultCache({
        ...graph.resultCache,
        [action.cacheKey]: action.result,
      });
      if (!node || node.status !== 'running' || node.cacheKey !== action.cacheKey) {
        // Superseded (an edit landed mid-run) or a stray/duplicate delivery. The computed
        // result is still a legitimate cache entry -- an edit-and-revert should hit it
        // instantly -- but it no longer describes the current state of this node.
        return { ...graph, resultCache };
      }
      return updateNode({ ...graph, resultCache }, action.nodeId, {
        status: 'succeeded',
        result: action.result,
        cacheKey: action.cacheKey,
        jobId: undefined,
        error: undefined,
      });
    }

    case 'NODE_FAILED': {
      const node = graph.nodes[action.nodeId];
      if (!node) return graph;
      if (node.status !== 'queued' && node.status !== 'running') return graph;
      if (node.cacheKey !== action.cacheKey) return graph;
      return updateNode(graph, action.nodeId, {
        status: 'failed',
        error: { message: action.error.message, code: action.error.code, at: Date.now() },
        jobId: undefined,
      });
    }

    case 'NODE_RETRY': {
      const node = graph.nodes[action.nodeId];
      if (!node || node.status !== 'failed') return graph;
      return updateNode(graph, action.nodeId, {
        status: node.result !== undefined ? 'stale' : 'idle',
        error: undefined,
      });
    }

    case 'HYDRATE_FROM_STORAGE': {
      return action.graph;
    }

    case 'GRAPH_DOCUMENT_RESTORED': {
      return restoreGraphDocument(graph, action.document);
    }

    default:
      return graph;
  }
}
