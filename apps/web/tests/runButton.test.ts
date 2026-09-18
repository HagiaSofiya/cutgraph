import type { HealthResponse, RunPlan } from '@cutgraph/shared';
import { describe, expect, it } from 'vitest';
import { spendConfirmation, summarizePlan } from '../src/components/RunButton';

function makePlan(overrides: Partial<RunPlan> = {}): RunPlan {
  return { entries: [], generations: 0, clientSide: 0, cached: 0, blocked: 0, ...overrides };
}

function makeHealth(overrides: Partial<HealthResponse> = {}): HealthResponse {
  return {
    ok: true,
    adapter: { requested: 'runway', active: 'runway' },
    models: { textToImage: ['gen4_image'], imageToVideo: ['gen4.5'] },
    limits: { maxGenerationsTotal: 50, maxConcurrentJobs: 3, generationsUsed: 0, inFlight: 0 },
    ...overrides,
  } as HealthResponse;
}

describe('summarizePlan', () => {
  it('lists only the categories that have work in them', () => {
    expect(summarizePlan(makePlan({ generations: 3, cached: 2 }))).toBe('3 to generate · 2 cached');
    expect(summarizePlan(makePlan({ clientSide: 1, blocked: 4 }))).toBe('1 local · 4 blocked');
  });

  it('says so plainly when a run would do nothing', () => {
    expect(summarizePlan(makePlan())).toBe('up to date');
  });
});

describe('spendConfirmation', () => {
  it('does not gate a run that spends nothing', () => {
    expect(spendConfirmation(makePlan({ clientSide: 4, cached: 2 }), makeHealth())).toBeUndefined();
  });

  it('does not gate fixture mode, which bills no one', () => {
    const fixture = makeHealth({ adapter: { requested: 'fixture', active: 'fixture' } });
    expect(spendConfirmation(makePlan({ generations: 5 }), fixture)).toBeUndefined();
  });

  it('does not gate a fixture fallback, where the key was missing and nothing is billable', () => {
    const fallback = makeHealth({ adapter: { requested: 'runway', active: 'fixture' } });
    expect(spendConfirmation(makePlan({ generations: 5 }), fallback)).toBeUndefined();
  });

  it('does not gate when the server is unreachable, since the run cannot spend either', () => {
    expect(spendConfirmation(makePlan({ generations: 5 }), undefined)).toBeUndefined();
  });

  it('states the cost, the free hits and the remaining budget', () => {
    const health = makeHealth({
      limits: { maxGenerationsTotal: 50, maxConcurrentJobs: 3, generationsUsed: 10, inFlight: 0 },
    });
    const message = spendConfirmation(makePlan({ generations: 3, cached: 2 }), health)!;
    expect(message).toContain('3 real generations');
    expect(message).toContain('2 nodes are a free cache hit');
    expect(message).toContain('40 of the server’s generation budget remain'.replace('’', "'"));
  });

  it('warns up front when the plan outruns the budget, instead of failing node by node', () => {
    const health = makeHealth({
      limits: { maxGenerationsTotal: 50, maxConcurrentJobs: 3, generationsUsed: 48, inFlight: 0 },
    });
    const message = spendConfirmation(makePlan({ generations: 5 }), health)!;
    expect(message).toContain('Only 2 of');
    expect(message).toContain('3 would fail with a spend-limit error');
  });

  it('omits the budget line when the server caps nothing', () => {
    const health = makeHealth({
      limits: { maxGenerationsTotal: null, maxConcurrentJobs: null, generationsUsed: 7, inFlight: 0 },
    });
    const message = spendConfirmation(makePlan({ generations: 1 }), health)!;
    expect(message).toContain('1 real generation via Runway');
    expect(message).not.toContain('budget remain');
  });
});
