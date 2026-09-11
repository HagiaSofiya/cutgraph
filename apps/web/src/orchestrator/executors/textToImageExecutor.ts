import type { MediaRef } from '@cutgraph/shared';
import { createJob } from '../../api/client';
import { subscribeToJob } from '../../api/sse';
import { applySseEvent, mediaRefFromJobResult } from '../applySseEvent';
import type { Executor, ExecutorContext } from './types';

// Generation executors never dispatch NODE_RUNNING themselves -- that transition is driven by
// the backend's own 'job.running' SSE event (simulated latency happens server-side), via the
// same applySseEvent handler reconciliation uses after a refresh.
export const textToImageExecutor: Executor = {
  run(ctx: ExecutorContext): Promise<MediaRef> {
    return new Promise((resolve, reject) => {
      createJob({
        nodeType: 'textToImage',
        params: ctx.node.params as Record<string, unknown>,
        inputs: [],
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
