import { GRAPH_FILE_FORMAT, GRAPH_FILE_VERSION, GraphFileSchema } from '@cutgraph/shared';
import type { Graph, GraphDocument, GraphNode, MediaRef } from '@cutgraph/shared';
import { graphDocumentFromGraph } from './graphHistory';

export const GRAPH_FILE_NAME = 'cutgraph-graph.json';

// A saved graph is the same GraphDocument undo/redo already treats as "the user's edit": nodes,
// edges, positions and params, with every trace of runtime state left out. Results are not
// portable -- a blob: URL is meaningless in another tab and an upload URL is tied to one
// server -- so the file carries the pipeline, not its output.
export function serializeGraphFile(graph: Graph): string {
  const file = {
    format: GRAPH_FILE_FORMAT,
    version: GRAPH_FILE_VERSION,
    document: graphDocumentFromGraph(graph),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export type ParsedGraphFile =
  | { ok: true; document: GraphDocument }
  | { ok: false; error: string };

export function parseGraphFile(text: string): ParsedGraphFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' };
  }

  const parsed = GraphFileSchema.safeParse(raw);
  if (parsed.success) return { ok: true, document: parsed.data.document as GraphDocument };

  // A wrong envelope means the user picked some other JSON entirely, which deserves a plainer
  // answer than a Zod path into a shape they never intended to produce.
  const wrongEnvelope = parsed.error.issues.some(
    (issue) => issue.path[0] === 'format' || issue.path[0] === 'version',
  );
  if (wrongEnvelope) return { ok: false, error: 'That is not a cutgraph graph file.' };

  return { ok: false, error: parsed.error.issues[0]?.message ?? 'That file is not a valid graph.' };
}

// Every imported node starts idle: the file deliberately carries no results, and a status
// claiming otherwise would have nothing behind it. The current resultCache is carried across
// rather than cleared -- keys are derived from type, params and upstream output ids alone, so
// importing a pipeline this browser has already run resolves straight from cache instead of
// paying for it twice. This is the same merge Load sample does.
export function graphFromDocument(
  document: GraphDocument,
  resultCache: Record<string, MediaRef>,
): Graph {
  const nodes: Record<string, GraphNode> = {};
  for (const [id, node] of Object.entries(document.nodes)) {
    nodes[id] = { ...node, status: 'idle', updatedAt: Date.now() };
  }
  return { nodes, edges: { ...document.edges }, resultCache };
}

// An ImageInput's actual bytes live in this tab's blobStore under its node id, and no document
// carries them -- an imported one is a filename with nothing behind it. Worth saying out loud at
// import time rather than letting it surface as a failed node later.
export function imageInputCount(document: GraphDocument): number {
  return Object.values(document.nodes).filter((node) => node.type === 'imageInput').length;
}
