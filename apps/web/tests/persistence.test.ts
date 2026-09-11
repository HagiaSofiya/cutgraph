import { beforeEach, describe, expect, it } from 'vitest';
import { clearStoredGraph, loadGraph, sanitizeGraphForStorage, saveGraph } from '../src/state/persistence';
import { makeGraph, makeNode, makeResult } from './helpers';

beforeEach(() => {
  localStorage.clear();
});

describe('sanitizeGraphForStorage', () => {
  it('strips an ephemeral result and coerces status to stale (a persistent result was there before)', () => {
    const graph = makeGraph([
      makeNode({
        id: 'trim-1',
        type: 'trim',
        status: 'succeeded',
        result: makeResult('k1', { durability: 'ephemeral', url: 'blob:whatever' }),
        cacheKey: 'k1',
      }),
    ]);

    const sanitized = sanitizeGraphForStorage(graph);
    expect(sanitized.nodes['trim-1'].result).toBeUndefined();
    expect(sanitized.nodes['trim-1'].cacheKey).toBeUndefined();
    expect(sanitized.nodes['trim-1'].status).toBe('stale');
  });

  it('keeps a persistent result untouched (e.g. an uploaded ImageInput, or a generation fixture)', () => {
    const graph = makeGraph([
      makeNode({
        id: 'img-1',
        type: 'imageInput',
        status: 'succeeded',
        result: makeResult('k1', { durability: 'persistent' }),
        cacheKey: 'k1',
      }),
    ]);

    const sanitized = sanitizeGraphForStorage(graph);
    expect(sanitized.nodes['img-1'].result?.durability).toBe('persistent');
    expect(sanitized.nodes['img-1'].status).toBe('succeeded');
  });

  it('coerces an unreconcilable in-flight run (no jobId) to stale even with no result yet, matching markStaleIfMeaningful', () => {
    const graph = makeGraph([makeNode({ id: 'a', type: 'trim', status: 'running' })]);
    const sanitized = sanitizeGraphForStorage(graph);
    expect(sanitized.nodes.a.status).toBe('stale');
  });

  it('preserves a failed status (and its error) rather than flattening it to stale, even when a stale leftover result is stripped', () => {
    const graph = makeGraph([
      makeNode({
        id: 'a',
        type: 'trim',
        status: 'failed',
        error: { message: 'boom', at: 1 },
        result: makeResult('old', { durability: 'ephemeral', url: 'blob:x' }),
        cacheKey: 'old',
      }),
    ]);
    const sanitized = sanitizeGraphForStorage(graph);
    expect(sanitized.nodes.a.status).toBe('failed');
    expect(sanitized.nodes.a.error?.message).toBe('boom');
    expect(sanitized.nodes.a.result).toBeUndefined();
  });

  it('coerces an unreconcilable in-flight run to stale when it has a retained (persistent) result', () => {
    const graph = makeGraph([
      makeNode({
        id: 'a',
        type: 'imageInput',
        status: 'running',
        result: makeResult('old', { durability: 'persistent' }),
        cacheKey: 'old',
      }),
    ]);
    const sanitized = sanitizeGraphForStorage(graph);
    expect(sanitized.nodes.a.status).toBe('stale');
    expect(sanitized.nodes.a.result?.id).toBe('old');
  });

  it('leaves a reconcilable in-flight generation job (has a jobId) untouched', () => {
    const graph = makeGraph([
      makeNode({ id: 'a', type: 'textToImage', status: 'queued', cacheKey: 'k1' }),
    ]);
    // queued with no jobId yet is still unreconcilable -- add one to simulate "job created".
    graph.nodes.a.jobId = 'job-123';

    const sanitized = sanitizeGraphForStorage(graph);
    expect(sanitized.nodes.a.status).toBe('queued');
    expect(sanitized.nodes.a.jobId).toBe('job-123');
  });

  it('drops ephemeral entries from the result cache but keeps persistent ones', () => {
    const graph = makeGraph([]);
    graph.resultCache['persist-key'] = makeResult('persist-key', { durability: 'persistent' });
    graph.resultCache['ephemeral-key'] = makeResult('ephemeral-key', { durability: 'ephemeral', url: 'blob:x' });

    const sanitized = sanitizeGraphForStorage(graph);
    expect(sanitized.resultCache['persist-key']).toBeDefined();
    expect(sanitized.resultCache['ephemeral-key']).toBeUndefined();
  });
});

describe('saveGraph / loadGraph round trip', () => {
  it('round-trips a graph through localStorage', () => {
    const graph = makeGraph([
      makeNode({
        id: 'a',
        type: 'imageInput',
        status: 'succeeded',
        result: makeResult('k1', { durability: 'persistent' }),
        cacheKey: 'k1',
      }),
    ]);

    saveGraph(graph);
    const loaded = loadGraph();
    expect(loaded?.nodes.a.status).toBe('succeeded');
    expect(loaded?.nodes.a.result?.id).toBe('k1');
  });

  it('an ephemeral result does not survive the round trip', () => {
    const graph = makeGraph([
      makeNode({
        id: 'trim-1',
        type: 'trim',
        status: 'succeeded',
        result: makeResult('k1', { durability: 'ephemeral', url: 'blob:whatever' }),
        cacheKey: 'k1',
      }),
    ]);

    saveGraph(graph);
    const loaded = loadGraph();
    expect(loaded?.nodes['trim-1'].result).toBeUndefined();
    expect(loaded?.nodes['trim-1'].status).toBe('stale');
  });

  it('returns undefined when nothing has been saved', () => {
    clearStoredGraph();
    expect(loadGraph()).toBeUndefined();
  });

  it('returns undefined for corrupted storage rather than throwing', () => {
    localStorage.setItem('cutgraph:graph:v1', '{not valid json');
    expect(() => loadGraph()).not.toThrow();
    expect(loadGraph()).toBeUndefined();
  });
});
