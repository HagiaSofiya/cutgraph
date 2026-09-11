import { describe, expect, it, vi } from 'vitest';
import { makeNode, makeResult } from '../helpers';

const { remux, triggerDownload } = vi.hoisted(() => ({
  remux: vi.fn(),
  triggerDownload: vi.fn(),
}));

vi.mock('../../src/media/mediabunnyClient', () => ({ remux, triggerDownload }));

const { exportExecutor } = await import('../../src/orchestrator/executors/exportExecutor');

describe('exportExecutor', () => {
  it('remuxes the upstream clip, triggers a download, and returns a MediaRef with no poster', async () => {
    const blob = new Blob(['fake exported video']);
    remux.mockResolvedValueOnce({ blob, width: 1280, height: 720, durationSec: 6 });

    const dispatch = vi.fn();
    const upstream = makeResult('final-clip', { url: 'http://x/final.mp4', kind: 'video' });
    const node = makeNode({ id: 'export-1', type: 'export', params: { filename: 'my-video.mp4' } });

    const result = await exportExecutor.run({ node, upstream: [upstream], cacheKey: 'export-key', dispatch });

    expect(remux).toHaveBeenCalledWith('http://x/final.mp4');
    expect(triggerDownload).toHaveBeenCalledWith(blob, 'my-video.mp4');
    expect(result).toMatchObject({ id: 'export-key', kind: 'video', durability: 'ephemeral', durationSec: 6 });
    expect(result.posterUrl).toBeUndefined();
  });

  it('throws when there is no upstream video to export', async () => {
    const dispatch = vi.fn();
    const node = makeNode({ id: 'export-1', type: 'export', params: { filename: 'x.mp4' } });
    await expect(exportExecutor.run({ node, upstream: [], cacheKey: 'k', dispatch })).rejects.toThrow(/upstream/i);
  });
});
