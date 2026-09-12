import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HealthResponseSchema } from '@cutgraph/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config';
import { createApp } from '../src/index';

let tmpDir: string;

function configWith(overrides: Partial<AppConfig>): AppConfig {
  return {
    sim: { minLatencyMs: 0, maxLatencyMs: 0, minProcessingMs: 0, maxProcessingMs: 0, failureRate: 0 },
    jobRetentionMs: 60_000,
    port: 0,
    publicOrigin: 'http://localhost:8787',
    fixturesDir: path.join(tmpDir, 'fixtures'),
    uploadsDir: path.join(tmpDir, 'uploads'),
    ...overrides,
  };
}

async function health(config: AppConfig) {
  const res = await createApp(config).app.request('/api/health');
  return HealthResponseSchema.parse(await res.json());
}

beforeAll(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'cutgraph-health-test-'));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('GET /api/health adapter reporting', () => {
  it('reports the requested and active adapter separately when a runway key is missing', async () => {
    // The trap the badge exists for: asked for runway, silently serving fixtures.
    const body = await health(configWith({ adapter: 'runway', runwayApiKey: undefined }));

    expect(body.adapter).toEqual({ requested: 'runway', active: 'fixture' });
    expect(body.models).toEqual({ textToImage: [], imageToVideo: [] });
  });

  it('reports runway as active, with its models, once a key is present', async () => {
    const body = await health(configWith({ adapter: 'runway', runwayApiKey: 'key_test_not_a_real_key' }));

    expect(body.adapter).toEqual({ requested: 'runway', active: 'runway' });
    expect(body.models.textToImage).toContain('gen4_image');
    expect(body.models.imageToVideo).toContain('gen4.5');
  });

  it('reports the spend limits for a real adapter, and null (unlimited) for fixtures', async () => {
    const real = await health(
      configWith({
        adapter: 'runway',
        runwayApiKey: 'key_test_not_a_real_key',
        spendGuard: { maxGenerationsTotal: 7, maxConcurrentJobs: 2 },
      }),
    );
    expect(real.limits).toEqual({
      maxGenerationsTotal: 7,
      maxConcurrentJobs: 2,
      generationsUsed: 0,
      inFlight: 0,
    });

    const fixture = await health(configWith({}));
    expect(fixture.limits.maxGenerationsTotal).toBeNull();
    expect(fixture.limits.maxConcurrentJobs).toBeNull();
  });
});
