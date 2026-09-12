import { z } from 'zod';
import { JobErrorSchema, JobResultSchema } from './job';

const SseJobQueuedEventSchema = z.object({
  id: z.number(),
  event: z.literal('job.queued'),
  data: z.object({ jobId: z.string(), cacheKey: z.string(), at: z.number() }),
});

const SseJobRunningEventSchema = z.object({
  id: z.number(),
  event: z.literal('job.running'),
  data: z.object({ jobId: z.string(), cacheKey: z.string(), at: z.number() }),
});

const SseJobSucceededEventSchema = z.object({
  id: z.number(),
  event: z.literal('job.succeeded'),
  data: z.object({
    jobId: z.string(),
    cacheKey: z.string(),
    at: z.number(),
    result: JobResultSchema,
  }),
});

const SseJobFailedEventSchema = z.object({
  id: z.number(),
  event: z.literal('job.failed'),
  data: z.object({
    jobId: z.string(),
    cacheKey: z.string(),
    at: z.number(),
    error: JobErrorSchema,
  }),
});

export const SseEventSchema = z.discriminatedUnion('event', [
  SseJobQueuedEventSchema,
  SseJobRunningEventSchema,
  SseJobSucceededEventSchema,
  SseJobFailedEventSchema,
]);

export type SseEvent = z.infer<typeof SseEventSchema>;
