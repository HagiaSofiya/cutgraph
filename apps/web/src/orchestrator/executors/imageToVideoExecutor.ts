import type { MediaRef } from '@cutgraph/shared';
import { runGenerationJob } from './runGenerationJob';
import type { Executor, ExecutorContext } from './types';

export const imageToVideoExecutor: Executor = {
  run(ctx: ExecutorContext): Promise<MediaRef> {
    const image = ctx.upstream[0];
    if (!image) {
      return Promise.reject(new Error('Image to Video has no upstream image'));
    }

    return runGenerationJob(ctx, 'imageToVideo', [
      { url: image.url, kind: 'image', sha256: image.sha256 ?? '' },
    ]);
  },
};
