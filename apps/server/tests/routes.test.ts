import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AppConfig } from '../src/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/index';

let app: ReturnType<typeof createApp>['app'];
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'cutgraph-routes-test-'));
  const config: AppConfig = {
    sim: { minLatencyMs: 0, maxLatencyMs: 0, minProcessingMs: 0, maxProcessingMs: 0, failureRate: 0 },
    jobRetentionMs: 60_000,
    port: 0,
    publicOrigin: 'http://localhost:8787',
    fixturesDir: path.join(tmpDir, 'fixtures'),
    uploadsDir: path.join(tmpDir, 'uploads'),
  };
  app = createApp(config).app;
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      adapter: { requested: 'fixture', active: 'fixture' },
      models: { textToImage: [], imageToVideo: [] },
      limits: { maxGenerationsTotal: null, maxConcurrentJobs: null, generationsUsed: 0, inFlight: 0 },
    });
  });
});

describe('POST /api/jobs', () => {
  it('accepts a valid textToImage request and returns 202', async () => {
    const res = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeType: 'textToImage',
        params: { prompt: 'a cat', ratio: '1:1' },
        inputs: [],
        cacheKey: 'key-1',
      }),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe('queued');
    expect(body.cacheKey).toBe('key-1');
    expect(typeof body.jobId).toBe('string');
  });

  it('rejects a request with an unknown nodeType', async () => {
    const res = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeType: 'trim', params: {}, inputs: [], cacheKey: 'key-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects textToImage params that fail the per-type schema (empty prompt)', async () => {
    const res = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeType: 'textToImage',
        params: { prompt: '', ratio: '1:1' },
        inputs: [],
        cacheKey: 'key-1',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe('invalid params');
  });

  it('rejects malformed JSON', async () => {
    const res = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/jobs/:id', () => {
  it('returns the current status right after creation', async () => {
    const createRes = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeType: 'textToImage',
        params: { prompt: 'a dog', ratio: '16:9' },
        inputs: [],
        cacheKey: 'key-2',
      }),
    });
    const { jobId } = await createRes.json();

    const statusRes = await app.request(`/api/jobs/${jobId}`);
    expect(statusRes.status).toBe(200);
    const body = await statusRes.json();
    expect(body.jobId).toBe(jobId);
    expect(['queued', 'running', 'succeeded']).toContain(body.status); // sim delays are 0, may already be terminal
  });

  it('returns 404 for an unknown job id', async () => {
    const res = await app.request('/api/jobs/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/uploads', () => {
  it('accepts a multipart file upload and returns a server-resolvable url', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'photo.png', { type: 'image/png' }));

    const res = await app.request('/api/uploads', { method: 'POST', body: form });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.kind).toBe('image');
    expect(body.url).toMatch(/^http:\/\/localhost:8787\/uploads\//);
  });

  it('rejects a request with no file field', async () => {
    const form = new FormData();
    form.append('note', 'oops, no file');
    const res = await app.request('/api/uploads', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('rejects an unsupported file extension', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1])], 'notes.txt', { type: 'text/plain' }));
    const res = await app.request('/api/uploads', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/jobs/:id', () => {
  it('reports canceled:false for a job that does not exist', async () => {
    const res = await app.request('/api/jobs/no-such-job', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ canceled: false });
  });

  it('cancels an in-flight job and leaves it failed with a CANCELED code', async () => {
    const created = await app.request('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeType: 'textToImage',
        params: { prompt: 'a cat', ratio: '1:1' },
        inputs: [],
        cacheKey: 'cancel-key',
      }),
    });
    const { jobId } = await created.json();

    const canceled = await app.request(`/api/jobs/${jobId}`, { method: 'DELETE' });
    expect(await canceled.json()).toEqual({ canceled: true });

    const status = await app.request(`/api/jobs/${jobId}`);
    const body = await status.json();
    expect(body.status).toBe('failed');
    expect(body.error.code).toBe('CANCELED');

    // Cancelling again is a no-op, not a second terminal transition.
    const again = await app.request(`/api/jobs/${jobId}`, { method: 'DELETE' });
    expect(await again.json()).toEqual({ canceled: false });
  });
});
