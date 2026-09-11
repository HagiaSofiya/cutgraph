import { describe, expect, it, vi } from 'vitest';
import { makeNode, makeResult } from '../helpers';

const { concat, extractPoster } = vi.hoisted(() => ({
  concat: vi.fn(),
  extractPoster: vi.fn(),
}));

vi.mock('../../src/media/mediabunnyClient', () => ({ concat, extractPoster }));

const { concatExecutor } = await import('../../src/orchestrator/executors/concatExecutor');

describe('concatExecutor', () => {
  it('passes upstream urls through in the given (already handle-sorted) order', async () => {
    const blob = new Blob(['fake concatenated video']);
    concat.mockResolvedValueOnce({ blob, width: 1280, height: 720, durationSec: 9 });
    extractPoster.mockResolvedValueOnce('blob:poster-url');

    const dispatch = vi.fn();
    const clip1 = makeResult('clip-1', { url: 'http://x/clip-1.mp4', kind: 'video' });
    const clip2 = makeResult('clip-2', { url: 'http://x/clip-2.mp4', kind: 'video' });
    const node = makeNode({ id: 'concat-1', type: 'concat', params: {} });

    const result = await concatExecutor.run({
      node,
      upstream: [clip1, clip2],
      cacheKey: 'concat-key',
      dispatch,
    });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'NODE_RUNNING', nodeId: 'concat-1' }));
    expect(concat).toHaveBeenCalledWith(['http://x/clip-1.mp4', 'http://x/clip-2.mp4']);
    expect(result).toMatchObject({ id: 'concat-key', kind: 'video', durability: 'ephemeral', durationSec: 9 });
  });

  it('throws when there are no upstream clips at all', async () => {
    const dispatch = vi.fn();
    const node = makeNode({ id: 'concat-1', type: 'concat', params: {} });
    await expect(concatExecutor.run({ node, upstream: [], cacheKey: 'k', dispatch })).rejects.toThrow(/upstream/i);
  });
});
