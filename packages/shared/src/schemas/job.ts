import { z } from 'zod';
import { FAILURE_CODES } from '../types';
import type { NodeFailure } from '../types';

export const FailureCodeEnum = z.enum(FAILURE_CODES);

// The single wire shape for a failure, shared by the SSE job.failed event and the job status
// response so the two can't drift.
export const JobErrorSchema = z.object({
  message: z.string(),
  code: FailureCodeEnum.optional(),
});

// The two node types the backend actually orchestrates as jobs.
export const GenerationNodeTypeSchema = z.enum(['textToImage', 'imageToVideo']);

// Every media input handed to the fixture (or, later, a real) adapter must be a URL the
// server can fetch itself -- never an opaque id or a browser-only blob: URL. This is what
// keeps swapping in a real adapter a small diff instead of a new upload/storage feature.
export const MediaInputRefSchema = z.object({
  url: z.string(),
  kind: z.enum(['image', 'video']),
  sha256: z.string(),
});

export const CreateJobRequestSchema = z.object({
  nodeType: GenerationNodeTypeSchema,
  params: z.record(z.string(), z.unknown()),
  inputs: z.array(MediaInputRefSchema),
  cacheKey: z.string(),
});

export const JobStatusEnum = z.enum(['queued', 'running', 'succeeded', 'failed']);

export const JobResultSchema = z.object({
  url: z.string(),
  kind: z.enum(['image', 'video']),
  durationSec: z.number().optional(),
  width: z.number(),
  height: z.number(),
});

export const CreateJobResponseSchema = z.object({
  jobId: z.string(),
  status: z.literal('queued'),
  cacheKey: z.string(),
  createdAt: z.number(),
});

export const JobStatusResponseSchema = z.object({
  jobId: z.string(),
  status: JobStatusEnum,
  cacheKey: z.string(),
  result: JobResultSchema.optional(),
  error: JobErrorSchema.optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type MediaInputRef = z.infer<typeof MediaInputRefSchema>;
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>;
export type CreateJobResponse = z.infer<typeof CreateJobResponseSchema>;
export type JobStatusResponse = z.infer<typeof JobStatusResponseSchema>;
export type JobResult = z.infer<typeof JobResultSchema>;

// The adapter-facing shapes -- deliberately plain interfaces, not Zod schemas. By the time a
// request reaches a GenerationAdapter it has already passed CreateJobRequestSchema plus the
// per-node-type param schema, so re-validating here would just be ceremony.
export interface GenerateRequest {
  jobId: string;
  nodeType: z.infer<typeof GenerationNodeTypeSchema>;
  params: Record<string, unknown>;
  inputs: MediaInputRef[];
  cacheKey: string;
}

export type GenerateResult =
  | { ok: true; result: JobResult }
  | { ok: false; error: NodeFailure };

export interface GenerateHooks {
  // Called once the job moves from queued (simulated latency) to actually running (simulated
  // processing). Optional because a future real adapter that reports only a single terminal
  // webhook has nothing meaningful to call it with -- jobRunner falls back to marking the job
  // running immediately in that case.
  onRunning?: () => void;
}

export interface GenerationAdapter {
  // Must resolve, never throw, for expected/simulated failures -- keeps jobRunner's control
  // flow identical between the fixture adapter and a future real one.
  generate(request: GenerateRequest, hooks?: GenerateHooks): Promise<GenerateResult>;
}
