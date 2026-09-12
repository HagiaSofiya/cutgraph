import { z } from 'zod';
import { GenerationNodeTypeSchema } from './job';

export const AdapterKindSchema = z.enum(['fixture', 'runway']);

// What the server is actually doing, as opposed to what it was asked to do. `requested` and
// `active` differ exactly when a runway adapter was configured without a usable API key and the
// server fell back to fixtures -- previously a console.warn the browser could never see, which
// left "watching canned clips" and "spending real credits" looking identical on the canvas.
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  adapter: z.object({
    requested: AdapterKindSchema,
    active: AdapterKindSchema,
  }),
  // The models the active adapter can run, per generation node type. Empty in fixture mode:
  // fixture generation is a hash into a pool of pre-rendered files, not a model.
  models: z.record(GenerationNodeTypeSchema, z.array(z.string())),
  // null means "no limit" -- fixture mode runs an unbounded guard, and JSON has no Infinity.
  limits: z.object({
    maxGenerationsTotal: z.number().nullable(),
    maxConcurrentJobs: z.number().nullable(),
    generationsUsed: z.number(),
    inFlight: z.number(),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type AdapterKind = z.infer<typeof AdapterKindSchema>;
