import { actions } from '@cutgraph/shared';
import type { MediaRef } from '@cutgraph/shared';
import { uploadFile } from '../../api/client';
import { clearPendingUpload, getPendingUpload } from '../../media/blobStore';
import type { Executor, ExecutorContext } from './types';

async function probeImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const dims = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return dims;
}

// The only client-side executor whose output ends up 'persistent' rather than 'ephemeral' --
// uploading the file (rather than keeping it as a blob: URL) is what keeps it a fetchable,
// server-resolvable input for a downstream ImageToVideo job, and lets it survive a refresh.
export const imageInputExecutor: Executor = {
  async run(ctx: ExecutorContext): Promise<MediaRef> {
    ctx.dispatch(actions.nodeRunning(ctx.node.id, ctx.cacheKey));

    const file = getPendingUpload(ctx.node.id);
    if (!file) {
      throw new Error('No file has been selected for this Image Input node yet');
    }

    const [uploaded, dimensions] = await Promise.all([uploadFile(file), probeImageDimensions(file)]);
    clearPendingUpload(ctx.node.id);

    return {
      id: ctx.cacheKey,
      kind: 'image',
      url: uploaded.url,
      durability: 'persistent',
      sha256: uploaded.sha256,
      width: dimensions.width,
      height: dimensions.height,
    };
  },
};
