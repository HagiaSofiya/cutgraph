import type { Graph, GraphDocument, GraphDocumentNode, GraphEdge } from '@cutgraph/shared';
import { makeEdgeId } from '../canvas/edgeId';

export const PASTE_OFFSET = { x: 40, y: 40 };

// The selected nodes plus only the edges running *between* them. An edge with one end outside
// the selection is dropped on purpose: a copy rewired back into the original's upstream would
// silently share its inputs, which is not what copying a node means -- and on a generation node
// it would quietly make the copy a free cache hit of something the user meant to vary.
export function copyNodes(graph: Graph, nodeIds: string[]): GraphDocument {
  const selected = new Set(nodeIds.filter((id) => graph.nodes[id]));

  const nodes: Record<string, GraphDocumentNode> = {};
  for (const id of selected) {
    const node = graph.nodes[id];
    nodes[id] = { id, type: node.type, position: { ...node.position }, params: node.params };
  }

  const edges: Record<string, GraphEdge> = {};
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (selected.has(edge.source) && selected.has(edge.target)) edges[edgeId] = { ...edge };
  }

  return { nodes, edges };
}

export interface PasteResult {
  nodes: GraphDocumentNode[];
  edges: GraphEdge[];
}

// Re-ids a fragment so a paste never collides with what it was copied from, and rewrites its
// internal edges onto the new ids. `makeId` is injected rather than calling crypto.randomUUID
// here so a test can assert on the wiring rather than on whatever uuids turned up.
export function pasteFragment(
  fragment: GraphDocument,
  offset: { x: number; y: number },
  makeId: (nodeType: GraphDocumentNode['type']) => string,
): PasteResult {
  const idByOriginal = new Map<string, string>();
  const nodes = Object.values(fragment.nodes).map((node) => {
    const id = makeId(node.type);
    idByOriginal.set(node.id, id);
    return {
      id,
      type: node.type,
      position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
      params: node.params,
    };
  });

  const edges = Object.values(fragment.edges).flatMap((edge) => {
    const source = idByOriginal.get(edge.source);
    const target = idByOriginal.get(edge.target);
    if (!source || !target) return [];
    return [
      {
        id: makeEdgeId(source, edge.sourceHandle, target, edge.targetHandle),
        source,
        target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      },
    ];
  });

  return { nodes, edges };
}
