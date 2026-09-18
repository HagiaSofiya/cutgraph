import {
  actions,
  classifyRunNode,
  FailureCodeEnum,
  GENERATION_NODE_TYPES,
  incomingEdges,
  outgoingEdges,
  topoSort,
} from '@cutgraph/shared';
import type { Graph, GraphAction, MediaRef, NodeFailure, NodeType } from '@cutgraph/shared';
import type { Dispatch } from 'react';
import type { Executor } from './executors/types';

// Mirrors the server's own CUTGRAPH_MAX_CONCURRENT_JOBS default. With the paid adapter selected
// POST /api/jobs answers 429 past that many in-flight generations, and a 429 *fails* the node
// rather than queuing it -- so an uncapped fan-out would turn extra parallelism straight into
// failed nodes. Client-side executors count against the same budget: trim/concat/export are
// WebCodecs work, and an unbounded number of those at once is its own problem.
const DEFAULT_MAX_CONCURRENCY = 3;

// The node types whose entire input *is* the cache-key preimage (type + params + upstream output
// ids), so two nodes sharing a key are interchangeable and one run can serve both -- see the
// join in executeNode. Deliberately not every type: an ImageInput's real input is the file held
// in blobStore under its own node id, which no cache key describes, so two of those must stay
// independent even when their params match. Shared with the run plan, which has to count a
// joined pair as one generation to be honest about what a run costs.
const DEDUPED_BY_CACHE_KEY = GENERATION_NODE_TYPES;

export interface RunGraphDeps {
  getGraph: () => Graph;
  dispatch: Dispatch<GraphAction>;
  executors: Record<NodeType, Executor>;
  maxConcurrency?: number;
  // Aborting stops the run from starting anything further and asks in-flight generation jobs to
  // cancel. Nodes already past the point of no return (a mediabunny encode) still finish.
  signal?: AbortSignal;
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

// Structural rather than instanceof: anything rejecting with a recognized `code` (an ApiError
// from the job route, say) keeps its taxonomy, and anything else is just a message. Note that a
// *generation* node's failure has usually already been dispatched with its code by applySseEvent
// before the executor's rejection reaches here -- the reducer drops this second, poorer copy.
function failureFromError(err: unknown): NodeFailure {
  const message = err instanceof Error ? err.message : String(err);
  const code = FailureCodeEnum.safeParse((err as { code?: unknown } | null)?.code);
  return code.success ? { message, code: code.data } : { message };
}

type Limiter = (start: () => Promise<MediaRef>) => Promise<MediaRef>;

// Minimal FIFO semaphore. On release the slot is *handed* to the next waiter rather than
// decremented and re-acquired: a woken waiter only resumes a microtask later, and a caller
// arriving inside that window would otherwise slip into the free slot and push us over `max`.
function createLimiter(max: number): Limiter {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async (start) => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;

    try {
      return await start();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

// One node's whole lifecycle, read against a *fresh* graph: by the time this runs, every
// upstream has settled and dispatched. Never rejects -- an executor failure becomes NODE_FAILED
// and leaves sibling branches alone, exactly as it did when this was a sequential loop body.
async function executeNode(
  nodeId: string,
  deps: RunGraphDeps,
  limit: Limiter,
  inFlightByCacheKey: Map<string, Promise<MediaRef>>,
): Promise<void> {
  // Checked here rather than only at the top of the run: a node that has been waiting on an
  // upstream (or for a concurrency slot) must not start after the user pressed Stop.
  if (deps.signal?.aborted) return;

  const graph = deps.getGraph();
  const node = graph.nodes[nodeId];
  if (!node) return;

  // Both early exits (already-settled node, unresolved upstream) and the cache-key derivation
  // live in classifyRunNode, so the pre-run plan the Run button shows is computed by the very
  // same rules that decide this -- see selectRunPlan.
  const resolved = resolveUpstream(graph, nodeId);
  const { disposition, cacheKey } = classifyRunNode(graph, nodeId, resolved?.cacheKeyEntries);
  if (!resolved || cacheKey === undefined) return;
  if (disposition === 'settled' || disposition === 'blocked') return;

  const cached = graph.resultCache[cacheKey];
  if (disposition === 'cached' && cached) {
    // Instant hit -- e.g. an edit-and-revert. Still walked through queued/running so
    // the reducer's precondition chain accepts the terminal transition.
    deps.dispatch(actions.nodeQueued(nodeId, cacheKey));
    deps.dispatch(actions.nodeRunning(nodeId, cacheKey));
    deps.dispatch(actions.nodeSucceeded(nodeId, cacheKey, cached));
    return;
  }

  // Dispatched before a concurrency slot is acquired on purpose: a node waiting its turn is
  // precisely what 'queued' means, and the canvas already renders it as such.
  deps.dispatch(actions.nodeQueued(nodeId, cacheKey));

  // Two sibling generation nodes with the same params and the same upstream output derive the
  // *same* cache key. Sequentially the second was a free cache hit -- the first had already
  // populated resultCache by the time it was reached -- but concurrently both miss, and both
  // pay. Joining the in-flight promise preserves the one-generation-per-cache-key guarantee the
  // spend guard rests on. A joined failure is shared too; retry is still per-node.
  const sharedKey = DEDUPED_BY_CACHE_KEY.has(node.type) ? cacheKey : undefined;
  let work = sharedKey ? inFlightByCacheKey.get(sharedKey) : undefined;
  if (work) {
    // A joining node makes no executor call of its own, so nothing else will dispatch
    // NODE_RUNNING for it -- and NODE_SUCCEEDED is only accepted from 'running'.
    deps.dispatch(actions.nodeRunning(nodeId, cacheKey));
  } else {
    const executor = deps.executors[node.type];
    work = limit(() =>
      executor.run({ node, upstream: resolved.refs, cacheKey, dispatch: deps.dispatch, signal: deps.signal }),
    );
    // Set synchronously -- no await between the get above and this, so siblings can't both miss.
    if (sharedKey) inFlightByCacheKey.set(sharedKey, work);
  }

  try {
    deps.dispatch(actions.nodeSucceeded(nodeId, cacheKey, await work));
  } catch (err) {
    deps.dispatch(actions.nodeFailed(nodeId, cacheKey, failureFromError(err)));
  }
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
      const graph = deps.getGraph();
      const order = topoSort(graph, targetNodeIds);
      const limit = createLimiter(deps.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
      const inFlightByCacheKey = new Map<string, Promise<MediaRef>>();

      // One promise per node, settling when that node reaches a terminal state (or is skipped).
      // Each node waits on its own upstreams rather than on every node earlier in the
      // topological order, so independent branches -- the sample pipeline's two Image to Video
      // legs, say -- overlap instead of running back to back. Acyclic plus "slots are only held
      // during execution, never while waiting on an upstream" is what keeps this deadlock-free.
      const settled = new Map<string, Promise<void>>();
      for (const nodeId of order) {
        // Topological order guarantees every in-run upstream already has an entry here.
        const upstream = incomingEdges(graph, nodeId)
          .map((edge) => edge.source)
          .filter((id) => settled.has(id));
        settled.set(
          nodeId,
          (async () => {
            await Promise.all(upstream.map((id) => settled.get(id)));
            await executeNode(nodeId, deps, limit, inFlightByCacheKey);
          })(),
        );
      }

      await Promise.all(settled.values());
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
