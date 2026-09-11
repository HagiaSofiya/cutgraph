import { actions, deriveCacheKey, incomingEdges, outgoingEdges, topoSort } from '@cutgraph/shared';
import type { Graph, GraphAction, MediaRef, NodeType } from '@cutgraph/shared';
import type { Dispatch } from 'react';
import type { Executor } from './executors/types';

export interface RunGraphDeps {
  getGraph: () => Graph;
  dispatch: Dispatch<GraphAction>;
  executors: Record<NodeType, Executor>;
}

interface ResolvedUpstream {
  refs: MediaRef[];
  cacheKeyEntries: Array<{ handle: string | null; sourceNodeId: string; outputId: string }>;
}

function compareHandle(a: string | null | undefined, b: string | null | undefined): number {
  if ((a ?? null) === (b ?? null)) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : 1;
}

// Only ever feeds a node's upstream forward when that upstream is exactly 'succeeded' with a
// result -- a failed upstream's retained (stale) result is displayable but must never be
// treated as fresh input. Returns undefined when any upstream isn't ready: "blocked", not
// itself a failure for this node.
function resolveUpstream(graph: Graph, nodeId: string): ResolvedUpstream | undefined {
  const edges = [...incomingEdges(graph, nodeId)].sort((a, b) => compareHandle(a.targetHandle, b.targetHandle));

  const refs: MediaRef[] = [];
  const cacheKeyEntries: ResolvedUpstream['cacheKeyEntries'] = [];
  for (const edge of edges) {
    const sourceNode = graph.nodes[edge.source];
    if (!sourceNode || sourceNode.status !== 'succeeded' || !sourceNode.result) return undefined;
    refs.push(sourceNode.result);
    cacheKeyEntries.push({
      handle: edge.targetHandle ?? null,
      sourceNodeId: edge.source,
      outputId: sourceNode.result.id,
    });
  }
  return { refs, cacheKeyEntries };
}

export function terminalNodeIds(graph: Graph): string[] {
  return Object.keys(graph.nodes).filter((id) => outgoingEdges(graph, id).length === 0);
}

// A fresh runGraph per instance, each with its own re-entrancy guard -- a bare module-level
// flag would let one test's hung promise silently swallow the next test's call. The real app
// uses a single shared instance (see the exported `runGraph` below); tests make their own.
export function createRunGraph() {
  let runInFlight = false;

  return async function runGraph(targetNodeIds: string[], deps: RunGraphDeps): Promise<void> {
    if (runInFlight) return; // a real TOCTOU window the reducer alone can't close
    runInFlight = true;
    try {
      const order = topoSort(deps.getGraph(), targetNodeIds);

      for (const nodeId of order) {
        const graph = deps.getGraph();
        const node = graph.nodes[nodeId];
        if (!node) continue;
        if (node.status !== 'idle' && node.status !== 'stale' && node.status !== 'failed') continue;

        const resolved = resolveUpstream(graph, nodeId);
        if (!resolved) continue; // blocked by an unresolved (or failed) upstream

        const cacheKey = deriveCacheKey({
          nodeType: node.type,
          params: node.params as Record<string, unknown>,
          upstream: resolved.cacheKeyEntries,
        });

        const cached = graph.resultCache[cacheKey];
        if (cached) {
          // Instant hit -- e.g. an edit-and-revert. Still walked through queued/running so
          // the reducer's precondition chain accepts the terminal transition.
          deps.dispatch(actions.nodeQueued(nodeId, cacheKey));
          deps.dispatch(actions.nodeRunning(nodeId, cacheKey));
          deps.dispatch(actions.nodeSucceeded(nodeId, cacheKey, cached));
          continue;
        }

        deps.dispatch(actions.nodeQueued(nodeId, cacheKey));
        try {
          const executor = deps.executors[node.type];
          const result = await executor.run({ node, upstream: resolved.refs, cacheKey, dispatch: deps.dispatch });
          deps.dispatch(actions.nodeSucceeded(nodeId, cacheKey, result));
        } catch (err) {
          // Does not abort the loop -- independent branches keep going.
          deps.dispatch(actions.nodeFailed(nodeId, cacheKey, { message: err instanceof Error ? err.message : String(err) }));
        }
      }
    } finally {
      runInFlight = false;
    }
  };
}

export const runGraph = createRunGraph();

// Retry never cascades forward: passing only the failed node id as the target means topoSort
// restricts to it plus its (already-succeeded) ancestors, so nothing downstream is touched
// until the user presses Run again. Takes the run function as a parameter (defaulting to the
// shared singleton) so tests can supply their own isolated `createRunGraph()` instance.
export function retryNode(
  nodeId: string,
  deps: RunGraphDeps,
  run: (targetNodeIds: string[], deps: RunGraphDeps) => Promise<void> = runGraph,
): Promise<void> {
  deps.dispatch(actions.nodeRetry(nodeId));
  return run([nodeId], deps);
}
