import { describe, expect, it, vi } from 'vitest';
import { makeNode, makeResult } from '../helpers';

const { trim, extractPoster } = vi.hoisted(() => ({
  trim: vi.fn(),
  extractPoster: vi.fn(),
}));

vi.mock('../../src/media/mediabunnyClient', () => ({ trim, extractPoster }));

const { trimExecutor } = await import('../../src/orchestrator/executors/trimExecutor');

describe('trimExecutor', () => {
  it('dispatches NODE_RUNNING immediately, then trims the upstream clip and returns an ephemeral MediaRef', async () => {
    const blob = new Blob(['fake video bytes']);
    trim.mockResolvedValueOnce({ blob, width: 1280, height: 720, durationSec: 3 });
    extractPoster.mockResolvedValueOnce('blob:poster-url');

    const dispatch = vi.fn();
    const upstream = makeResult('upstream-key', { url: 'http://x/clip.mp4', kind: 'video' });
    const node = makeNode({ id: 'trim-1', type: 'trim', params: { start: 1, end: 4 } });

    const result = await trimExecutor.run({ node, upstream: [upstream], cacheKey: 'trim-key', dispatch });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'NODE_RUNNING', nodeId: 'trim-1', cacheKey: 'trim-key' }));
    expect(trim).toHaveBeenCalledWith('http://x/clip.mp4', 1, 4);
    expect(result).toMatchObject({
      id: 'trim-key',
      kind: 'video',
      durability: 'ephemeral',
      posterUrl: 'blob:poster-url',
      width: 1280,
      height: 720,
      durationSec: 3,
    });
  });

  it('throws when there is no upstream video to trim', async () => {
    const dispatch = vi.fn();
    const node = makeNode({ id: 'trim-1', type: 'trim', params: { start: 0, end: 1 } });

    await expect(trimExecutor.run({ node, upstream: [], cacheKey: 'trim-key', dispatch })).rejects.toThrow(/upstream/i);
  });
});
