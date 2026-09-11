import type { GenerateRequest } from '@cutgraph/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FixtureGenerationAdapter } from '../src/jobs/fixtureAdapter';
import { IMAGE_FIXTURES, VIDEO_FIXTURES } from '../src/jobs/fixturePool';

const sim = {
  minLatencyMs: 10,
  maxLatencyMs: 10,
  minProcessingMs: 10,
  maxProcessingMs: 10,
  failureRate: 0,
};

const baseTextToImageRequest: GenerateRequest = {
  jobId: 'job-1',
  nodeType: 'textToImage',
  params: { prompt: 'a cat', ratio: '1:1' },
  inputs: [],
  cacheKey: 'k1',
};

beforeEach(() => {
  vi.useFakeTimers();
});

describe('FixtureGenerationAdapter', () => {
  it('picks the same fixture for the same params every time (deterministic)', async () => {
    const adapter = new FixtureGenerationAdapter(sim, 'http://localhost:8787/fixtures');
    const p1 = adapter.generate(baseTextToImageRequest);
    await vi.runAllTimersAsync();
    const r1 = await p1;

    const p2 = adapter.generate(baseTextToImageRequest);
    await vi.runAllTimersAsync();
    const r2 = await p2;

    expect(r1).toEqual(r2);
  });

  it('picks a fixture from the image pool for textToImage', async () => {
    const adapter = new FixtureGenerationAdapter(sim, 'http://localhost:8787/fixtures');
    const promise = adapter.generate(baseTextToImageRequest);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.kind).toBe('image');
      expect(IMAGE_FIXTURES.some((f) => result.result.url.endsWith(f.file))).toBe(true);
    }
  });

  it('picks a fixture from the video pool for imageToVideo', async () => {
    const adapter = new FixtureGenerationAdapter(sim, 'http://localhost:8787/fixtures');
    const request: GenerateRequest = {
      ...baseTextToImageRequest,
      nodeType: 'imageToVideo',
      params: { prompt: 'walk forward', duration: 4, ratio: '16:9' },
    };
    const promise = adapter.generate(request);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.kind).toBe('video');
      expect(VIDEO_FIXTURES.some((f) => result.result.url.endsWith(f.file))).toBe(true);
      expect(result.result.durationSec).toBeGreaterThan(0);
    }
  });

  it('forces failure when failureRate is 1', async () => {
    const adapter = new FixtureGenerationAdapter({ ...sim, failureRate: 1 }, 'http://localhost:8787/fixtures');
    const promise = adapter.generate(baseTextToImageRequest);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(false);
  });

  it('forces success when failureRate is 0', async () => {
    const adapter = new FixtureGenerationAdapter({ ...sim, failureRate: 0 }, 'http://localhost:8787/fixtures');
    const promise = adapter.generate(baseTextToImageRequest);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.ok).toBe(true);
  });

  it('calls onRunning after the latency phase but before resolving', async () => {
    const adapter = new FixtureGenerationAdapter(
      { minLatencyMs: 1000, maxLatencyMs: 1000, minProcessingMs: 1000, maxProcessingMs: 1000, failureRate: 0 },
      'http://localhost:8787/fixtures',
    );
    const onRunning = vi.fn();
    const promise = adapter.generate(baseTextToImageRequest, { onRunning });

    await vi.advanceTimersByTimeAsync(999);
    expect(onRunning).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2);
    expect(onRunning).toHaveBeenCalledTimes(1);

    await vi.runAllTimersAsync();
    await promise;
  });

  it('respects latency/processing bounds without waiting in real time', async () => {
    const adapter = new FixtureGenerationAdapter(
      { minLatencyMs: 5000, maxLatencyMs: 5000, minProcessingMs: 5000, maxProcessingMs: 5000, failureRate: 0 },
      'http://localhost:8787/fixtures',
    );
    let settled = false;
    const promise = adapter.generate(baseTextToImageRequest).then((r) => {
      settled = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(9999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    expect(settled).toBe(true);
    await promise;
  });
});
