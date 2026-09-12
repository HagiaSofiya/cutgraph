import type { HealthResponse } from '@cutgraph/shared';

function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

// Per-process spend guard for a paid generation adapter. Deliberately not persisted anywhere --
// a process restart resetting the counters is fine for a demo-scale deployment, and the whole
// point is bounding a single runaway process, not enforcing a durable quota.
export class SpendGuard {
  private totalStarted = 0;
  private inFlight = 0;

  constructor(
    private readonly maxGenerationsTotal: number,
    private readonly maxConcurrentJobs: number,
  ) {}

  // Call before queuing a job. Returns a rejection reason instead of throwing so the caller
  // (the POST /api/jobs handler) can turn it into a clear 429, not a queued job that immediately
  // fails.
  tryReserve(): { ok: true } | { ok: false; reason: string } {
    if (this.totalStarted >= this.maxGenerationsTotal) {
      return {
        ok: false,
        reason: `generation limit reached (${this.maxGenerationsTotal} per process)`,
      };
    }
    if (this.inFlight >= this.maxConcurrentJobs) {
      return {
        ok: false,
        reason: `too many concurrent generations (max ${this.maxConcurrentJobs})`,
      };
    }
    this.totalStarted += 1;
    this.inFlight += 1;
    return { ok: true };
  }

  // Read-only view for the health endpoint -- the browser has no other way to know how much of
  // the per-process budget a real adapter has already spent.
  snapshot(): HealthResponse['limits'] {
    return {
      // An unlimited guard is constructed with Infinity, which JSON.stringify turns into null
      // anyway -- mapping it deliberately keeps the wire shape valid instead of accidental.
      maxGenerationsTotal: finiteOrNull(this.maxGenerationsTotal),
      maxConcurrentJobs: finiteOrNull(this.maxConcurrentJobs),
      generationsUsed: this.totalStarted,
      inFlight: this.inFlight,
    };
  }

  // Call once the job reaches a terminal state (succeeded or failed).
  release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
  }
}
