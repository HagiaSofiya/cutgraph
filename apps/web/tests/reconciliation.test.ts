import { describe, expect, it, vi } from 'vitest';
import { makeGraph, makeNode } from './helpers';

const { getJobStatus } = vi.hoisted(() => ({ getJobStatus: vi.fn() }));
const { subscribeToJob } = vi.hoisted(() => ({ subscribeToJob: vi.fn() }));

vi.mock('../src/api/client', () => ({ getJobStatus }));
vi.mock('../src/api/sse', () => ({ subscribeToJob }));

const { reconcileInFlightJobs } = await import('../src/state/reconciliation');

const jobResult = { url: 'http://x/img.png', kind: 'image' as const, width: 10, height: 10 };

describe('reconcileInFlightJobs', () => {
  it('ignores nodes that are not queued/running, and nodes with no jobId', async () => {
    const graph = makeGraph([
      makeNode({ id: 'idle-node', type: 'textToImage', status: 'idle' }),
      makeNode({ id: 'succeeded-node', type: 'textToImage', status: 'succeeded' }),
      makeNode({ id: 'no-job', type: 'trim', status: 'running' }), // client-side node, no jobId
    ]);
    const dispatch = vi.fn();

    await reconcileInFlightJobs(graph, dispatch);

    expect(getJobStatus).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('dispatches NODE_FAILED with a clear message when the job is gone (404)', async () => {
    getJobStatus.mockResolvedValueOnce(undefined);
    const graph = makeGraph([
      makeNode({ id: 'a', type: 'textToImage', status: 'running', jobId: 'job-1', cacheKey: 'key-1' }),
    ]);
    const dispatch = vi.fn();

    await reconcileInFlightJobs(graph, dispatch);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const action = dispatch.mock.calls[0][0];
    expect(action.type).toBe('NODE_FAILED');
    expect(action.nodeId).toBe('a');
    expect(action.error.message).toMatch(/lost/i);
  });

  it('brings a still-queued node through running before applying an already-terminal (succeeded) status', async () => {
    getJobStatus.mockResolvedValueOnce({
      jobId: 'job-1',
      status: 'succeeded',
      cacheKey: 'key-1',
      result: jobResult,
      createdAt: 1,
      updatedAt: 2,
    });
    const graph = makeGraph([
      makeNode({ id: 'a', type: 'textToImage', status: 'queued', jobId: 'job-1', cacheKey: 'key-1' }),
    ]);
    const dispatch = vi.fn();

    await reconcileInFlightJobs(graph, dispatch);

    const actionTypes = dispatch.mock.calls.map((c) => c[0].type);
    expect(actionTypes).toEqual(['NODE_RUNNING', 'NODE_SUCCEEDED']);
    expect(subscribeToJob).not.toHaveBeenCalled();
  });

  it('applies an already-terminal failed status the same way', async () => {
    getJobStatus.mockResolvedValueOnce({
      jobId: 'job-1',
      status: 'failed',
      cacheKey: 'key-1',
      error: { message: 'simulated failure' },
      createdAt: 1,
      updatedAt: 2,
    });
    const graph = makeGraph([
      makeNode({ id: 'a', type: 'imageToVideo', status: 'running', jobId: 'job-1', cacheKey: 'key-1' }),
    ]);
    const dispatch = vi.fn();

    await reconcileInFlightJobs(graph, dispatch);

    const actionTypes = dispatch.mock.calls.map((c) => c[0].type);
    expect(actionTypes).toEqual(['NODE_RUNNING', 'NODE_FAILED']);
  });

  it('resumes a live SSE subscription for a job still genuinely in flight', async () => {
    getJobStatus.mockResolvedValueOnce({
      jobId: 'job-1',
      status: 'running',
      cacheKey: 'key-1',
      createdAt: 1,
      updatedAt: 2,
    });
    const graph = makeGraph([
      makeNode({ id: 'a', type: 'textToImage', status: 'running', jobId: 'job-1', cacheKey: 'key-1' }),
    ]);
    const dispatch = vi.fn();

    await reconcileInFlightJobs(graph, dispatch);

    expect(dispatch).not.toHaveBeenCalled(); // nothing new to apply yet
    expect(subscribeToJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ onEvent: expect.any(Function) }));
  });
});
