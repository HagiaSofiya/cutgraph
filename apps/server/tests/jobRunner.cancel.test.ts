import type { GenerateRequest, GenerateResult, GenerationAdapter } from '@cutgraph/shared';
import { describe, expect, it, vi } from 'vitest';
import { JobRunner } from '../src/jobs/jobRunner';
import { JobStore } from '../src/jobs/jobStore';

// An adapter whose generate() never settles -- the exact case that used to hold a spend-guard
// concurrency slot forever.
function hangingAdapter(): GenerationAdapter & { cancel: ReturnType<typeof vi.fn> } {
  return {
    generate: () => new Promise<GenerateResult>(() => {}),
    cancel: vi.fn().mockResolvedValue(undefined),
  };
}

function createJob(runner: JobRunner, onSettled?: () => void) {
  return runner.create('textToImage', { prompt: 'a cat', ratio: '1:1' }, [], 'k1', onSettled);
}

const settle = () => new Promise((r) => setTimeout(r, 40));

describe('JobRunner timeout', () => {
  it('fails a job whose adapter never settles, and frees its spend slot', async () => {
    const store = new JobStore(60_000);
    const runner = new JobRunner(store, hangingAdapter(), 20);
    const onSettled = vi.fn();

    const { jobId } = createJob(runner, onSettled);
    await settle();

    const record = store.get(jobId);
    expect(record?.status).toBe('failed');
    expect(record?.error?.code).toBe('TIMEOUT');
    expect(onSettled).toHaveBeenCalledOnce();
  });
});

describe('JobRunner cancel', () => {
  it('marks an in-flight job canceled, stops the remote task, and frees its slot immediately', async () => {
    const store = new JobStore(60_000);
    const adapter = hangingAdapter();
    // Long timeout: the slot must be freed by the cancel itself, not by the timeout firing.
    const runner = new JobRunner(store, adapter, 60_000);
    const onSettled = vi.fn();

    const { jobId } = createJob(runner, onSettled);
    expect(await runner.cancel(jobId)).toBe(true);

    expect(adapter.cancel).toHaveBeenCalledWith(jobId);
    const record = store.get(jobId);
    expect(record?.status).toBe('failed');
    expect(record?.error?.code).toBe('CANCELED');
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('reports false for an unknown or already-terminal job, and never double-frees a slot', async () => {
    const store = new JobStore(60_000);
    const runner = new JobRunner(store, hangingAdapter(), 20);
    const onSettled = vi.fn();

    const { jobId } = createJob(runner, onSettled);
    await settle(); // times out -> terminal

    expect(await runner.cancel(jobId)).toBe(false);
    expect(await runner.cancel('no-such-job')).toBe(false);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('still cancels when the adapter has no cancellation of its own (fixture mode)', async () => {
    const store = new JobStore(60_000);
    const adapter: GenerationAdapter = { generate: () => new Promise<GenerateResult>(() => {}) };
    const runner = new JobRunner(store, adapter, 60_000);

    const { jobId } = createJob(runner);
    expect(await runner.cancel(jobId)).toBe(true);
    expect(store.get(jobId)?.error?.code).toBe('CANCELED');
  });

  it('does not let a failing adapter.cancel stop the job from being marked canceled', async () => {
    const store = new JobStore(60_000);
    const adapter: GenerationAdapter = {
      generate: () => new Promise<GenerateResult>(() => {}),
      cancel: () => Promise.reject(new Error('remote task already gone')),
    };
    const runner = new JobRunner(store, adapter, 60_000);

    const { jobId } = createJob(runner);
    expect(await runner.cancel(jobId)).toBe(true);
    expect(store.get(jobId)?.error?.code).toBe('CANCELED');
  });
});

describe('a job that settles normally', () => {
  it('is unaffected by the timeout and releases its slot once', async () => {
    const store = new JobStore(60_000);
    const adapter: GenerationAdapter = {
      async generate(_request: GenerateRequest): Promise<GenerateResult> {
        return { ok: true, result: { url: 'http://x/y.png', kind: 'image', width: 1, height: 1 } };
      },
    };
    const runner = new JobRunner(store, adapter, 60_000);
    const onSettled = vi.fn();

    const { jobId } = createJob(runner, onSettled);
    await settle();

    expect(store.get(jobId)?.status).toBe('succeeded');
    expect(onSettled).toHaveBeenCalledOnce();
  });
});
