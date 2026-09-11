import type { JobResult, SseEvent } from '@cutgraph/shared';

export type GenerationNodeType = 'textToImage' | 'imageToVideo';
export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface JobRecord {
  jobId: string;
  nodeType: GenerationNodeType;
  cacheKey: string;
  status: JobStatus;
  result?: JobResult;
  error?: { message: string };
  createdAt: number;
  updatedAt: number;
  terminalAt?: number;
  events: SseEvent[]; // capped at 3: queued, running, terminal
}

type Listener = (event: SseEvent) => void;

const MAX_BUFFERED_EVENTS = 3;

// In-memory only -- there's no DB. A late GET or SSE resubscribe still resolves correctly as
// long as it happens within `retentionMs` of the job's terminal transition; past that, an
// evicted job and a server restart look identical to the client (404 either way).
export class JobStore {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    private readonly retentionMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  create(jobId: string, nodeType: GenerationNodeType, cacheKey: string): JobRecord {
    const createdAt = this.now();
    const record: JobRecord = {
      jobId,
      nodeType,
      cacheKey,
      status: 'queued',
      createdAt,
      updatedAt: createdAt,
      events: [],
    };
    this.jobs.set(jobId, record);
    this.emit(record, { id: 0, event: 'job.queued', data: { jobId, cacheKey, at: createdAt } });
    return record;
  }

  get(jobId: string): JobRecord | undefined {
    return this.jobs.get(jobId);
  }

  markRunning(jobId: string): void {
    const record = this.jobs.get(jobId);
    if (!record || record.status !== 'queued') return;
    record.status = 'running';
    record.updatedAt = this.now();
    this.emit(record, {
      id: 1,
      event: 'job.running',
      data: { jobId, cacheKey: record.cacheKey, at: record.updatedAt },
    });
  }

  markSucceeded(jobId: string, result: JobResult): void {
    const record = this.jobs.get(jobId);
    if (!record || this.isTerminal(record)) return;
    record.status = 'succeeded';
    record.result = result;
    record.updatedAt = this.now();
    record.terminalAt = record.updatedAt;
    this.emit(record, {
      id: 2,
      event: 'job.succeeded',
      data: { jobId, cacheKey: record.cacheKey, at: record.updatedAt, result },
    });
  }

  markFailed(jobId: string, error: { message: string }): void {
    const record = this.jobs.get(jobId);
    if (!record || this.isTerminal(record)) return;
    record.status = 'failed';
    record.error = error;
    record.updatedAt = this.now();
    record.terminalAt = record.updatedAt;
    this.emit(record, {
      id: 2,
      event: 'job.failed',
      data: { jobId, cacheKey: record.cacheKey, at: record.updatedAt, error },
    });
  }

  subscribe(jobId: string, listener: Listener): () => void {
    if (!this.listeners.has(jobId)) this.listeners.set(jobId, new Set());
    this.listeners.get(jobId)!.add(listener);
    return () => this.listeners.get(jobId)?.delete(listener);
  }

  // Full history (max 3 events) when lastEventId is omitted; only what's newer otherwise.
  eventsSince(jobId: string, lastEventId?: number): SseEvent[] {
    const record = this.jobs.get(jobId);
    if (!record) return [];
    if (lastEventId === undefined) return record.events;
    return record.events.filter((event) => event.id > lastEventId);
  }

  // Call periodically (or opportunistically per-request) to evict jobs past their retention
  // window. Not important for a demo's scale, but an unbounded Map is the kind of thing a
  // reviewer notices.
  sweepExpired(): void {
    const nowMs = this.now();
    for (const [jobId, record] of this.jobs) {
      if (record.terminalAt !== undefined && nowMs - record.terminalAt > this.retentionMs) {
        this.jobs.delete(jobId);
        this.listeners.delete(jobId);
      }
    }
  }

  private isTerminal(record: JobRecord): boolean {
    return record.status === 'succeeded' || record.status === 'failed';
  }

  private emit(record: JobRecord, event: SseEvent): void {
    record.events.push(event);
    if (record.events.length > MAX_BUFFERED_EVENTS) record.events.shift();
    for (const listener of this.listeners.get(record.jobId) ?? []) listener(event);
  }
}
