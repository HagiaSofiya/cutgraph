import type { MediaRef } from '@cutgraph/shared';
import { createJob } from '../../api/client';
import { subscribeToJob } from '../../api/sse';
import { applySseEvent, mediaRefFromJobResult } from '../applySseEvent';
import type { Executor, ExecutorContext } from './types';

export const imageToVideoExecutor: Executor = {
  run(ctx: ExecutorContext): Promise<MediaRef> {
    const image = ctx.upstream[0];
    if (!image) {
      return Promise.reject(new Error('Image to Video has no upstream image'));
    }

    return new Promise((resolve, reject) => {
      createJob({
        nodeType: 'imageToVideo',
        params: ctx.node.params as Record<string, unknown>,
        inputs: [{ url: image.url, kind: 'image', sha256: image.sha256 ?? '' }],
        cacheKey: ctx.cacheKey,
      })
        .then(({ jobId }) => {
          const unsubscribe = subscribeToJob(jobId, {
            onEvent: (event) => {
              applySseEvent(ctx.dispatch, ctx.node.id, event);
              if (event.event === 'job.succeeded') {
                unsubscribe();
                resolve(mediaRefFromJobResult(event.data.cacheKey, event.data.result));
              } else if (event.event === 'job.failed') {
                unsubscribe();
                reject(new Error(event.data.error.message));
              }
            },
            onError: (err) => {
              unsubscribe();
              reject(err instanceof Error ? err : new Error('SSE connection error'));
            },
          });
        })
        .catch(reject);
    });
  },
};
