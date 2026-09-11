import type { GenerateHooks, GenerateRequest, GenerateResult, GenerationAdapter } from '@cutgraph/shared';
import { describe, expect, it } from 'vitest';
import { JobRunner } from '../src/jobs/jobRunner';
import { JobStore } from '../src/jobs/jobStore';

class ControllableAdapter implements GenerationAdapter {
  private resolveFn?: (result: GenerateResult) => void;
  private hooks?: GenerateHooks;
  lastRequest?: GenerateRequest;

  generate(request: GenerateRequest, hooks?: GenerateHooks): Promise<GenerateResult> {
    this.lastRequest = request;
    this.hooks = hooks;
    return new Promise((resolve) => {
      this.resolveFn = resolve;
    });
  }

  signalRunning() {
    this.hooks?.onRunning?.();
  }

  resolve(result: GenerateResult) {
    this.resolveFn?.(result);
  }
}

class ThrowingAdapter implements GenerationAdapter {
  async generate(): Promise<GenerateResult> {
    throw new Error('adapter blew up');
  }
}

describe('JobRunner', () => {
  it('creates a queued job immediately and returns its id', () => {
    const store = new JobStore(60_000);
    const runner = new JobRunner(store, new ControllableAdapter());
    const { jobId } = runner.create('textToImage', { prompt: 'a cat', ratio: '1:1' }, [], 'key-1');

    expect(runner.get(jobId)?.status).toBe('queued');
  });

  it('transitions queued -> running when the adapter signals onRunning', async () => {
    const store = new JobStore(60_000);
    const adapter = new ControllableAdapter();
    const runner = new JobRunner(store, adapter);
    const { jobId } = runner.create('textToImage', { prompt: 'a cat', ratio: '1:1' }, [], 'key-1');

    adapter.signalRunning();
    expect(runner.get(jobId)?.status).toBe('running');
  });

  it('transitions to succeeded when the adapter resolves ok', async () => {
    const store = new JobStore(60_000);
    const adapter = new ControllableAdapter();
    const runner = new JobRunner(store, adapter);
    const { jobId } = runner.create('textToImage', { prompt: 'a cat', ratio: '1:1' }, [], 'key-1');

    adapter.signalRunning();
    const result = { url: 'http://x/img.png', kind: 'image' as const, width: 10, height: 10 };
    adapter.resolve({ ok: true, result });
    await new Promise((r) => setImmediate(r));

    const record = runner.get(jobId);
    expect(record?.status).toBe('succeeded');
    expect(record?.result).toEqual(result);
  });

  it('transitions to failed when the adapter resolves not ok', async () => {
    const store = new JobStore(60_000);
    const adapter = new ControllableAdapter();
    const runner = new JobRunner(store, adapter);
    const { jobId } = runner.create('textToImage', { prompt: 'a cat', ratio: '1:1' }, [], 'key-1');

    adapter.resolve({ ok: false, error: { message: 'simulated failure' } });
    await new Promise((r) => setImmediate(r));

    const record = runner.get(jobId);
    expect(record?.status).toBe('failed');
    expect(record?.error?.message).toBe('simulated failure');
  });

  it('treats an adapter that throws (violates the "never throw" contract) as a failure rather than wedging the job', async () => {
    const store = new JobStore(60_000);
    const runner = new JobRunner(store, new ThrowingAdapter());
    const { jobId } = runner.create('textToImage', { prompt: 'a cat', ratio: '1:1' }, [], 'key-1');

    await new Promise((r) => setImmediate(r));

    const record = runner.get(jobId);
    expect(record?.status).toBe('failed');
    expect(record?.error?.message).toContain('adapter blew up');
  });

  it('passes the cacheKey and inputs through to the adapter request unchanged', () => {
    const store = new JobStore(60_000);
    const adapter = new ControllableAdapter();
    const runner = new JobRunner(store, adapter);
    const inputs = [{ url: 'http://x/upload.png', kind: 'image' as const, sha256: 'abc' }];

    runner.create('imageToVideo', { prompt: 'walk', duration: 4, ratio: '16:9' }, inputs, 'cache-key-xyz');

    expect(adapter.lastRequest?.cacheKey).toBe('cache-key-xyz');
    expect(adapter.lastRequest?.inputs).toEqual(inputs);
    expect(adapter.lastRequest?.nodeType).toBe('imageToVideo');
  });
});
