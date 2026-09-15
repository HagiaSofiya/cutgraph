import type { Graph, GraphAction, GraphDocument, GraphDocumentNode } from '@cutgraph/shared';

export const GRAPH_HISTORY_LIMIT = 50;
export const PARAM_CHANGE_COALESCE_MS = 500;

interface HistoryEntry {
  before: GraphDocument;
  after: GraphDocument;
  coalesceKey?: string;
  recordedAt: number;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function cloneDocument(document: GraphDocument): GraphDocument {
  const nodes: Record<string, GraphDocumentNode> = {};
  for (const [id, node] of Object.entries(document.nodes)) {
    nodes[id] = { ...node, position: { ...node.position }, params: cloneValue(node.params) };
  }
  const edges = Object.fromEntries(Object.entries(document.edges).map(([id, edge]) => [id, { ...edge }]));
  return { nodes, edges };
}

export function graphDocumentFromGraph(graph: Graph): GraphDocument {
  const nodes: Record<string, GraphDocumentNode> = {};
  for (const [id, node] of Object.entries(graph.nodes)) {
    nodes[id] = {
      id: node.id,
      type: node.type,
      position: { ...node.position },
      params: cloneValue(node.params),
    };
  }
  const edges = Object.fromEntries(Object.entries(graph.edges).map(([id, edge]) => [id, { ...edge }]));
  return { nodes, edges };
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.hasOwn(bRecord, key) && deepEqual(aRecord[key], bRecord[key]))
  );
}

export function graphDocumentsEqual(a: GraphDocument, b: GraphDocument): boolean {
  return deepEqual(a, b);
}

export function isGraphEditAction(action: GraphAction): boolean {
  switch (action.type) {
    case 'NODE_ADDED':
    case 'NODE_REMOVED':
    case 'NODE_MOVED':
    case 'NODES_MOVED':
    case 'EDGE_ADDED':
    case 'EDGE_REMOVED':
    case 'PARAM_CHANGED':
    case 'HYDRATE_FROM_STORAGE':
      return true;
    default:
      return false;
  }
}

function coalesceKey(action: GraphAction, before: GraphDocument, after: GraphDocument): string | undefined {
  if (action.type !== 'PARAM_CHANGED') return undefined;
  const beforeParams = before.nodes[action.nodeId]?.params;
  const afterParams = after.nodes[action.nodeId]?.params;
  if (beforeParams === null || afterParams === null || typeof beforeParams !== 'object' || typeof afterParams !== 'object') {
    return undefined;
  }
  const beforeRecord = beforeParams as Record<string, unknown>;
  const afterRecord = afterParams as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])]
    .filter((key) => !deepEqual(beforeRecord[key], afterRecord[key]))
    .sort();
  return keys.length > 0 ? `params:${action.nodeId}:${JSON.stringify(keys)}` : undefined;
}

export class GraphHistory {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get undoDepth(): number {
    return this.past.length;
  }

  record(before: GraphDocument, after: GraphDocument, action: GraphAction, recordedAt = Date.now()): boolean {
    if (!isGraphEditAction(action) || graphDocumentsEqual(before, after)) return false;

    const nextCoalesceKey = coalesceKey(action, before, after);
    const previous = this.past.at(-1);
    if (
      nextCoalesceKey &&
      previous?.coalesceKey === nextCoalesceKey &&
      recordedAt >= previous.recordedAt &&
      recordedAt - previous.recordedAt <= PARAM_CHANGE_COALESCE_MS
    ) {
      previous.after = cloneDocument(after);
      previous.recordedAt = recordedAt;
    } else {
      this.past.push({
        before: cloneDocument(before),
        after: cloneDocument(after),
        coalesceKey: nextCoalesceKey,
        recordedAt,
      });
      if (this.past.length > GRAPH_HISTORY_LIMIT) this.past.shift();
    }
    this.future = [];
    return true;
  }

  undo(): GraphDocument | undefined {
    const entry = this.past.pop();
    if (!entry) return undefined;
    this.future.push(entry);
    return cloneDocument(entry.before);
  }

  redo(): GraphDocument | undefined {
    const entry = this.future.pop();
    if (!entry) return undefined;
    this.past.push(entry);
    if (this.past.length > GRAPH_HISTORY_LIMIT) this.past.shift();
    return cloneDocument(entry.after);
  }
}
