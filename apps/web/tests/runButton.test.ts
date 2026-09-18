import { selectRunPlan } from '@cutgraph/shared';
import type { HealthResponse, RunPlan } from '@cutgraph/shared';
import { describe, expect, it } from 'vitest';
import { runTargetsForScope, spendConfirmation, summarizePlan } from '../src/components/RunButton';
import { makeEdge, makeGraph, makeNode } from './helpers';

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

describe('runTargetsForScope', () => {
  // a -> b -> c, with an unrelated second branch x -> y. The prompts differ on purpose: with
  // identical params the two branches would derive identical cache keys and collapse into one
  // generation, which is correct but would hide what this test is actually about.
  const graph = makeGraph(
    [
      makeNode({ id: 'a', type: 'textToImage', params: { prompt: 'a' } }),
      makeNode({ id: 'b', type: 'imageToVideo', params: { prompt: 'b' } }),
      makeNode({ id: 'c', type: 'export', params: { filename: 'c.mp4' } }),
      makeNode({ id: 'x', type: 'textToImage', params: { prompt: 'x' } }),
      makeNode({ id: 'y', type: 'imageToVideo', params: { prompt: 'y' } }),
    ],
    [
      makeEdge({ id: 'ab', source: 'a', target: 'b' }),
      makeEdge({ id: 'bc', source: 'b', target: 'c' }),
      makeEdge({ id: 'xy', source: 'x', target: 'y' }),
    ],
  );

  it('falls back to the whole graph when nothing is selected', () => {
    expect(runTargetsForScope(graph, 'selection', [])).toBeUndefined();
    expect(runTargetsForScope(graph, 'downstream', [])).toBeUndefined();
    expect(runTargetsForScope(graph, 'graph', ['a'])).toBeUndefined();
  });

  it('targets exactly the selection, leaving what comes after it alone', () => {
    expect(runTargetsForScope(graph, 'selection', ['b'])).toEqual(['b']);
  });

  it('adds every downstream node when asked, and nothing from an unrelated branch', () => {
    expect(runTargetsForScope(graph, 'downstream', ['a'])).toEqual(['a', 'b', 'c']);
    expect(runTargetsForScope(graph, 'downstream', ['b'])).toEqual(['b', 'c']);
  });

  it('de-duplicates when a selection already contains its own downstream', () => {
    expect(runTargetsForScope(graph, 'downstream', ['a', 'b'])).toEqual(['a', 'b', 'c']);
  });

  it('keeps an unrelated branch out of a scoped run, which is the point of scoping', () => {
    // 'selection' still pulls in ancestors -- a run cannot skip what it depends on -- but the
    // x -> y branch is neither an ancestor nor downstream, so it is not paid for.
    const plan = selectRunPlan(graph, runTargetsForScope(graph, 'selection', ['b'])!);
    expect(plan.entries.map((e) => e.nodeId).sort()).toEqual(['a', 'b']);
    expect(plan.generations).toBe(2);

    const whole = selectRunPlan(graph, ['c', 'y']);
    expect(whole.generations).toBe(4);
  });
});
