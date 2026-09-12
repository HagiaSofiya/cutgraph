import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { FixtureGenerationAdapter } from '../src/jobs/fixtureAdapter';
import { JobRunner } from '../src/jobs/jobRunner';
import { JobStore } from '../src/jobs/jobStore';
import { SpendGuard } from '../src/jobs/spendGuard';
import { createJobsRoute } from '../src/routes/jobs';

const sim = { minLatencyMs: 0, maxLatencyMs: 0, minProcessingMs: 0, maxProcessingMs: 0, failureRate: 0 };

function buildApp(spendGuard: SpendGuard) {
  const store = new JobStore(60_000);
  const runner = new JobRunner(store, new FixtureGenerationAdapter(sim, 'http://localhost:8787/fixtures'));
  const app = new Hono();
  app.route('/api/jobs', createJobsRoute(runner, store, spendGuard));
  return { app, store };
}

const body = JSON.stringify({
  nodeType: 'textToImage',
  params: { prompt: 'a cat', ratio: '1:1' },
  inputs: [],
  cacheKey: 'k1',
});

describe('POST /api/jobs spend guard', () => {
  it('rejects at the route with 429 once the total generation limit is reached, without queuing a job', async () => {
    const { app } = buildApp(new SpendGuard(1, 10));

    const first = await app.request('/api/jobs', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    expect(first.status).toBe(202);

    const second = await app.request('/api/jobs', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    expect(second.status).toBe(429);
    const payload = await second.json();
    expect(payload.error.message).toContain('generation limit');
  });

  it('rejects at the route with 429 once the concurrency limit is reached', async () => {
    const { app } = buildApp(new SpendGuard(10, 1));

    const first = await app.request('/api/jobs', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    expect(first.status).toBe(202);

    const second = await app.request('/api/jobs', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    expect(second.status).toBe(429);
    const payload = await second.json();
    expect(payload.error.message).toContain('concurrent');
  });

  it('frees the concurrency slot once the job settles, allowing a subsequent request through', async () => {
    const { app } = buildApp(new SpendGuard(10, 1));

    const first = await app.request('/api/jobs', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    expect(first.status).toBe(202);

    // sim latency/processing are both 0, so the fixture adapter's promise settles on the
    // microtask queue almost immediately -- give it a tick to reach the terminal SSE event
    // that releases the guard's concurrency slot.
    await new Promise((r) => setTimeout(r, 10));

    const second = await app.request('/api/jobs', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    expect(second.status).toBe(202);
  });

  it('codes the 429 as SPEND_LIMIT so the canvas can say retrying will not help', async () => {
    const { app } = buildApp(new SpendGuard(1, 10));

    await app.request('/api/jobs', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
    const rejected = await app.request('/api/jobs', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });

    expect(rejected.status).toBe(429);
    expect((await rejected.json()).error.code).toBe('SPEND_LIMIT');
  });
});
