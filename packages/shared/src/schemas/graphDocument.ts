import { z } from 'zod';
import { NodeTypeSchema } from './common';
import { GraphEdgeSchema } from './graph';
import { validateNodeParams } from './nodeParams';

// Stamped into every saved file so a graph can be told apart from any other JSON a user might
// pick, and so a future change to the document shape has something to branch on rather than
// guessing from structure.
export const GRAPH_FILE_FORMAT = 'cutgraph.graph';
export const GRAPH_FILE_VERSION = 1;

export const GraphDocumentNodeSchema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  position: z.object({ x: z.number(), y: z.number() }),
  // Narrowed per node type in the document's own refinement below, where the type is known --
  // GraphNodeSchema leaves params unvalidated, which is survivable for localStorage we wrote
  // ourselves and not for a file that arrived from somewhere else.
  params: z.unknown(),
});

export const GraphDocumentSchema = z
  .object({
    nodes: z.record(z.string(), GraphDocumentNodeSchema),
    edges: z.record(z.string(), GraphEdgeSchema),
  })
  .superRefine((document, ctx) => {
    for (const [nodeId, node] of Object.entries(document.nodes)) {
      const params = validateNodeParams(node.type, node.params);
      if (!params.success) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', nodeId, 'params'],
          message: `${node.type} node "${nodeId}": ${params.error.issues[0]?.message ?? 'invalid params'}`,
        });
      }
    }

    // The reducer guards this on EDGE_ADDED but not on a wholesale graph replace, so an edge
    // pointing at a node that is not in the file would land as permanently unresolvable
    // upstream -- a node stuck blocked with nothing on the canvas to explain why.
    for (const [edgeId, edge] of Object.entries(document.edges)) {
      const missing = [edge.source, edge.target].filter((id) => !document.nodes[id]);
      if (missing.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['edges', edgeId],
          message: `edge "${edgeId}" points at missing node(s): ${missing.join(', ')}`,
        });
      }
    }
  });

export const GraphFileSchema = z.object({
  format: z.literal(GRAPH_FILE_FORMAT),
  version: z.literal(GRAPH_FILE_VERSION),
  document: GraphDocumentSchema,
});

export type GraphFile = z.infer<typeof GraphFileSchema>;
