import type { MediaInputRef, MediaRef } from '@cutgraph/shared';
import { cancelJob, createJob } from '../../api/client';
import { subscribeToJob } from '../../api/sse';
import { applySseEvent, mediaRefFromJobResult } from '../applySseEvent';
import type { ExecutorContext } from './types';

// Carries the FailureCode the same structural way ApiError does, so a canceled node reads as
// 'Canceled' on the canvas rather than as an anonymous error.
export class CanceledError extends Error {
  readonly code = 'CANCELED' as const;

  constructor() {
    super('Canceled');
    this.name = 'CanceledError';
  }
}

// Both generation executors are the same flow -- create a job, follow its SSE stream, settle on
// the terminal event -- differing only in node type and inputs. Cancellation is why this is now
// shared rather than duplicated: aborting has to unsubscribe, tell the server to stop the remote
// task, and reject, and getting that subtly different in two places is how a paid generation
// keeps billing after the user pressed Stop.
export function runGenerationJob(
  ctx: ExecutorContext,
  nodeType: 'textToImage' | 'imageToVideo',
  inputs: MediaInputRef[],
): Promise<MediaRef> {
  return new Promise<MediaRef>((resolve, reject) => {
    if (ctx.signal?.aborted) {
      reject(new CanceledError());
      return;
    }

    let unsubscribe = () => {};
    let jobId: string | undefined;
    let settled = false;

    // Every exit runs through here: exactly one settlement, and no leaked EventSource or abort
    // listener regardless of which path got there first.
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      ctx.signal?.removeEventListener('abort', onAbort);
      settle();
    };

    function onAbort() {
      const id = jobId;
      finish(() => {
        // If the job was already created, stop the remote work -- otherwise a paid generation
        // runs (and bills) to completion after the run was abandoned.
        if (id) void cancelJob(id).catch(() => {});
        reject(new CanceledError());
      });
    }

    ctx.signal?.addEventListener('abort', onAbort, { once: true });

    createJob({
      nodeType,
      params: ctx.node.params as Record<string, unknown>,
      inputs,
      cacheKey: ctx.cacheKey,
    })
      .then((created) => {
        jobId = created.jobId;
        if (settled) {
          // Aborted while the create request was still in flight: the job exists on the server
          // now, so it still needs stopping even though this promise is already rejected.
          void cancelJob(created.jobId).catch(() => {});
          return;
        }

        unsubscribe = subscribeToJob(created.jobId, {
          onEvent: (event) => {
            applySseEvent(ctx.dispatch, ctx.node.id, event);
            if (event.event === 'job.succeeded') {
              finish(() => resolve(mediaRefFromJobResult(event.data.cacheKey, event.data.result)));
            } else if (event.event === 'job.failed') {
              finish(() =>
                reject(Object.assign(new Error(event.data.error.message), { code: event.data.error.code })),
              );
            }
          },
          onError: (err) => {
            finish(() => reject(err instanceof Error ? err : new Error('SSE connection error')));
          },
        });
      })
      .catch((err: unknown) => finish(() => reject(err)));
  });
}
