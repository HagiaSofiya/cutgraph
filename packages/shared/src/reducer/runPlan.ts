import { deriveCacheKey } from '../cache/cacheKey';
import type { CacheKeyUpstreamEntry } from '../cache/cacheKey';
import type { Graph, NodeType } from '../types';
import { incomingEdges, topoSort } from './selectors';

// The two node types whose work is a call to the generation adapter -- the only ones that can
// cost money, and (not coincidentally) the only ones whose entire input is the cache-key
// preimage, which is what lets runGraph join two of them deriving the same key into one call.
export const GENERATION_NODE_TYPES: ReadonlySet<NodeType> = new Set<NodeType>([
  'textToImage',
  'imageToVideo',
]);

// What a run would do with one node, mirroring executeNode's early exits in their own order:
// 'settled' is a node the run skips because it is not idle/stale/failed, 'blocked' is one whose
// upstream will not be ready, 'cached' is a derived key already sitting in resultCache (free and
// instant), and 'execute' is real work.
export type RunDisposition = 'execute' | 'cached' | 'blocked' | 'settled';

export interface RunNodeClassification {
  disposition: RunDisposition;
  cacheKey?: string; // absent only when blocked -- there is no resolved upstream to derive from
}

// The single place that decides what a run does with a node. runGraph calls it with the upstream
// it actually resolved; selectRunPlan calls it with upstream ids predicted one topological step
// ahead. Sharing it is the whole point: a preview that re-implemented these rules would drift
// from the run it claims to describe and start quietly lying about cost.
export function classifyRunNode(
  graph: Graph,
  nodeId: string,
  upstream: CacheKeyUpstreamEntry[] | undefined,
): RunNodeClassification {
  const node = graph.nodes[nodeId];
  if (!node) return { disposition: 'settled' };
  if (node.status !== 'idle' && node.status !== 'stale' && node.status !== 'failed') {
    return { disposition: 'settled' };
  }
  if (!upstream) return { disposition: 'blocked' };

  const cacheKey = deriveCacheKey({
    nodeType: node.type,
    params: node.params as Record<string, unknown>,
    upstream,
  });
  return { disposition: graph.resultCache[cacheKey] ? 'cached' : 'execute', cacheKey };
}

export interface RunPlanEntry extends RunNodeClassification {
  nodeId: string;
  nodeType: NodeType;
}

export interface RunPlan {
  entries: RunPlanEntry[];
  // Distinct generations the run would pay for -- distinct, not a node count, because runGraph
  // joins two generation nodes deriving the same key into a single adapter call, so counting
  // nodes would overstate the bill.
  generations: number;
  clientSide: number;
  cached: number;
  blocked: number;
}

// What running `targetNodeIds` (plus everything they depend on) would actually do, computed
// without executing anything. This is a plan, not a prophecy: it assumes every node it says will
// execute succeeds, which is the only assumption under which downstream nodes are reachable at
// all. A failure mid-run makes the rest of the plan's tail optimistic, exactly as the run's own
// topological walk does.
export function selectRunPlan(graph: Graph, targetNodeIds: string[]): RunPlan {
  const order = topoSort(graph, targetNodeIds);

  // What each node's output id will be once the run reaches it. MediaRef.id *is* the cache key
  // that produced it, everywhere in this codebase, so a node's predicted key doubles as its
  // predicted output id -- which is the identity that makes a transitive prediction possible
  // without running anything. A node that will not end the run 'succeeded' gets no entry here,
  // so everything downstream of it reads as blocked, exactly as resolveUpstream would decide.
  const predictedOutputId = new Map<string, string>();
  const entries: RunPlanEntry[] = [];

  for (const nodeId of order) {
    const node = graph.nodes[nodeId];
    if (!node) continue;

    // No sort: deriveCacheKey canonicalizes upstream order internally, so feeding it edges in
    // record order is safe here in a way it would not be for the run's own `refs` array.
    const upstream: CacheKeyUpstreamEntry[] = [];
    let resolvable = true;
    for (const edge of incomingEdges(graph, nodeId)) {
      const outputId = predictedOutputId.get(edge.source);
      if (outputId === undefined) {
        resolvable = false;
        break;
      }
      upstream.push({ handle: edge.targetHandle ?? null, sourceNodeId: edge.source, outputId });
    }

    const classification = classifyRunNode(graph, nodeId, resolvable ? upstream : undefined);
    entries.push({ nodeId, nodeType: node.type, ...classification });

    if (classification.disposition === 'settled') {
      // Skipped by the run, so whatever it already holds is what downstream would see -- and
      // only a node that actually succeeded holds something resolveUpstream would accept.
      if (node.status === 'succeeded' && node.result) predictedOutputId.set(nodeId, node.result.id);
    } else if (classification.cacheKey !== undefined) {
      predictedOutputId.set(nodeId, classification.cacheKey);
    }
  }

  const executing = entries.filter((entry) => entry.disposition === 'execute');
  const generationKeys = new Set(
    executing
      .filter((entry) => GENERATION_NODE_TYPES.has(entry.nodeType))
      .map((entry) => entry.cacheKey as string),
  );

  return {
    entries,
    generations: generationKeys.size,
    clientSide: executing.filter((entry) => !GENERATION_NODE_TYPES.has(entry.nodeType)).length,
    cached: entries.filter((entry) => entry.disposition === 'cached').length,
    blocked: entries.filter((entry) => entry.disposition === 'blocked').length,
  };
}
