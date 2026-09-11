import { fnv1a32, stableStringify } from '@cutgraph/shared';
import type {
  GenerateHooks,
  GenerateRequest,
  GenerateResult,
  GenerationAdapter,
} from '@cutgraph/shared';
import type { SimConfig } from '../config';
import {
  IMAGE_FIXTURES,
  IMAGE_FIXTURES_SUBDIR,
  VIDEO_FIXTURES,
  VIDEO_FIXTURES_SUBDIR,
} from './fixturePool';

function randomBetween(min: number, max: number, random: () => number): number {
  return min + random() * (max - min);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The one seam a real (paid) adapter drops into later. Everything below is simulation --
// jobRunner only ever calls `generate()` and never knows it's talking to a fixture.
export class FixtureGenerationAdapter implements GenerationAdapter {
  constructor(
    private readonly sim: SimConfig,
    private readonly fixturesBaseUrl: string,
    private readonly random: () => number = Math.random,
  ) {}

  async generate(request: GenerateRequest, hooks?: GenerateHooks): Promise<GenerateResult> {
    await sleep(randomBetween(this.sim.minLatencyMs, this.sim.maxLatencyMs, this.random));
    hooks?.onRunning?.();
    await sleep(randomBetween(this.sim.minProcessingMs, this.sim.maxProcessingMs, this.random));

    if (this.random() < this.sim.failureRate) {
      return {
        ok: false,
        error: {
          message: `Simulated generation failure for ${request.nodeType}`,
          code: 'SIMULATED_FAILURE',
        },
      };
    }

    // Deterministic on params alone -- the fixture adapter never needs real media bytes, so
    // request.inputs (server-resolvable URLs, kept honest for a future real adapter) is
    // intentionally unused here.
    if (request.nodeType === 'textToImage') {
      const pick = IMAGE_FIXTURES[fnv1a32(stableStringify(request.params)) % IMAGE_FIXTURES.length];
      return {
        ok: true,
        result: {
          url: `${this.fixturesBaseUrl}/${IMAGE_FIXTURES_SUBDIR}/${pick.file}`,
          kind: 'image',
          width: pick.width,
          height: pick.height,
        },
      };
    }

    const pick = VIDEO_FIXTURES[fnv1a32(stableStringify(request.params)) % VIDEO_FIXTURES.length];
    return {
      ok: true,
      result: {
        url: `${this.fixturesBaseUrl}/${VIDEO_FIXTURES_SUBDIR}/${pick.file}`,
        kind: 'video',
        durationSec: pick.durationSec,
        width: pick.width,
        height: pick.height,
      },
    };
  }
}
