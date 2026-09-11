import { randomUUID } from 'node:crypto';
import type { GenerateRequest, GenerationAdapter } from '@cutgraph/shared';
import type { JobRecord } from './jobStore';
import { JobStore } from './jobStore';

// Adapter-agnostic on purpose: this class only ever calls `adapter.generate()` and translates
// the result into JobStore updates. Swapping the fixture adapter for a real one later touches
// zero code here.
export class JobRunner {
  constructor(
    private readonly store: JobStore,
    private readonly adapter: GenerationAdapter,
  ) {}

  create(
    nodeType: GenerateRequest['nodeType'],
    params: Record<string, unknown>,
    inputs: GenerateRequest['inputs'],
    cacheKey: string,
  ): { jobId: string; createdAt: number } {
    const jobId = randomUUID();
    const record = this.store.create(jobId, nodeType, cacheKey);
    const request: GenerateRequest = { jobId, nodeType, params, inputs, cacheKey };

    // Fire-and-forget from the caller's perspective -- the route responds 202 immediately;
    // this promise's resolution is what eventually updates the job store and fans out SSE.
    this.adapter
      .generate(request, { onRunning: () => this.store.markRunning(jobId) })
      .then((result) => {
        if (result.ok) this.store.markSucceeded(jobId, result.result);
        else this.store.markFailed(jobId, result.error);
      })
      .catch((err: unknown) => {
        // The adapter contract says "never throw", but a genuinely broken adapter shouldn't
        // wedge the job in queued/running forever either.
        this.store.markFailed(jobId, {
          message: err instanceof Error ? err.message : String(err),
        });
      });

    return { jobId, createdAt: record.createdAt };
  }

  get(jobId: string): JobRecord | undefined {
    return this.store.get(jobId);
  }
}
