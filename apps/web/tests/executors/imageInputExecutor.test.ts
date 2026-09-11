import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPendingUpload } from '../../src/media/blobStore';
import { makeNode } from '../helpers';

const { uploadFile } = vi.hoisted(() => ({ uploadFile: vi.fn() }));
vi.mock('../../src/api/client', () => ({ uploadFile }));

const { imageInputExecutor } = await import('../../src/orchestrator/executors/imageInputExecutor');

beforeEach(() => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn().mockResolvedValue({ width: 100, height: 50, close: vi.fn() }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('imageInputExecutor', () => {
  it('uploads the pending file and returns a persistent MediaRef with probed dimensions', async () => {
    uploadFile.mockResolvedValueOnce({ url: 'http://x/uploads/abc.png', sha256: 'abc', kind: 'image' });
    const file = new File(['fake bytes'], 'photo.png', { type: 'image/png' });
    setPendingUpload('img-1', file);

    const dispatch = vi.fn();
    const node = makeNode({ id: 'img-1', type: 'imageInput', params: { sourceName: 'photo.png', sourceSize: 10, sourceLastModified: 1 } });

    const result = await imageInputExecutor.run({ node, upstream: [], cacheKey: 'cache-key-1', dispatch });

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'NODE_RUNNING', nodeId: 'img-1' }));
    expect(uploadFile).toHaveBeenCalledWith(file);
    expect(result).toMatchObject({
      id: 'cache-key-1',
      kind: 'image',
      url: 'http://x/uploads/abc.png',
      durability: 'persistent',
      sha256: 'abc',
      width: 100,
      height: 50,
    });
  });

  it('throws a clear error when no file has been selected yet', async () => {
    const dispatch = vi.fn();
    const node = makeNode({ id: 'img-no-file', type: 'imageInput', params: {} });
    await expect(
      imageInputExecutor.run({ node, upstream: [], cacheKey: 'k', dispatch }),
    ).rejects.toThrow(/no file/i);
  });
});
