import { z } from 'zod';
import { MediaRefSchema, NodeStatusSchema, NodeTypeSchema } from './common';

export const GraphNodeSchema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  position: z.object({ x: z.number(), y: z.number() }),
  params: z.record(z.string(), z.unknown()),
  status: NodeStatusSchema,
  result: MediaRefSchema.optional(),
  cacheKey: z.string().optional(),
  error: z.object({ message: z.string(), at: z.number() }).optional(),
  jobId: z.string().optional(),
  updatedAt: z.number(),
});

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  sourceHandle: z.string().nullable().optional(),
  target: z.string(),
  targetHandle: z.string().nullable().optional(),
});

export const GraphSchema = z.object({
  nodes: z.record(z.string(), GraphNodeSchema),
  edges: z.record(z.string(), GraphEdgeSchema),
  resultCache: z.record(z.string(), MediaRefSchema),
});
