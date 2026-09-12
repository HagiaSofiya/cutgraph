import { randomUUID } from 'node:crypto';
import type { GenerateRequest, GenerateResult, GenerationAdapter } from '@cutgraph/shared';
import type { JobRecord } from './jobStore';
import { JobStore } from './jobStore';

// A job that never settles used to hold its spend-guard concurrency slot forever: the slot was
// released by the terminal SSE event, and a hung adapter never produces one. This cap is what
// makes "the adapter always settles" true, so the release below is guaranteed to run. Generous
// on purpose -- a real image-to-video generation legitimately takes minutes.
export const DEFAULT_JOB_TIMEOUT_MS = 600_000;

// Adapter-agnostic on purpose: this class only ever calls `adapter.generate()` (and, to cancel,
// the optional `adapter.cancel()`) and translates the result into JobStore updates.
export class JobRunner {
  // Releases the job's spend-guard slot, called at most once per job by whichever of "the
  // adapter settled" and "the job was canceled" happens first.
  private readonly releasers = new Map<string, () => void>();

  constructor(
    private readonly store: JobStore,
    private readonly adapter: GenerationAdapter,
    private readonly timeoutMs: number = DEFAULT_JOB_TIMEOUT_MS,
  ) {}

  create(
    nodeType: GenerateRequest['nodeType'],
    params: Record<string, unknown>,
    inputs: GenerateRequest['inputs'],
    cacheKey: string,
    onSettled?: () => void,
  ): { jobId: string; createdAt: number } {
    const jobId = randomUUID();
    const record = this.store.create(jobId, nodeType, cacheKey);
    const request: GenerateRequest = { jobId, nodeType, params, inputs, cacheKey };

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.releasers.delete(jobId);
      onSettled?.();
    };
    this.releasers.set(jobId, release);

    // Fire-and-forget from the caller's perspective -- the route responds 202 immediately;
    // this promise's resolution is what eventually updates the job store and fans out SSE.
    this.runWithTimeout(request)
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
      })
      .finally(release);

    return { jobId, createdAt: record.createdAt };
  }

  get(jobId: string): JobRecord | undefined {
    return this.store.get(jobId);
  }

  // Best-effort: tells the adapter to stop the remote work (so a paid task stops billing) and
  // marks the job failed as CANCELED either way. Returns false for a job that is already
  // terminal or unknown, which the route turns into a 404/409-ish no-op rather than a lie.
  async cancel(jobId: string): Promise<boolean> {
    const record = this.store.get(jobId);
    if (!record || record.status === 'succeeded' || record.status === 'failed') return false;

    try {
      await this.adapter.cancel?.(jobId);
    } catch {
      // The remote task may already be finished, or the adapter may not support cancellation.
      // Neither changes what this job is now: canceled.
    }

    this.store.markFailed(jobId, { message: 'Canceled', code: 'CANCELED' });
    // The adapter's own promise may stay pending indefinitely after a cancel, so the slot is
    // freed here rather than waiting for the .finally() above (which release() makes a no-op).
    this.releasers.get(jobId)?.();
    return true;
  }

  private async runWithTimeout(request: GenerateRequest): Promise<GenerateResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<GenerateResult>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            ok: false,
            error: {
              message: `Generation exceeded the ${Math.round(this.timeoutMs / 1000)}s server timeout.`,
              code: 'TIMEOUT',
            },
          }),
        this.timeoutMs,
      );
    });

    const work = this.adapter.generate(request, { onRunning: () => this.store.markRunning(request.jobId) });
    // Once the race is decided by the timeout nothing observes `work` again, so a late rejection
    // from a broken adapter would otherwise surface as an unhandled rejection.
    work.catch(() => {});

    try {
      return await Promise.race([work, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
