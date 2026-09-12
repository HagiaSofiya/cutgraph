import type { MediaRef } from '@cutgraph/shared';
import { runGenerationJob } from './runGenerationJob';
import type { Executor, ExecutorContext } from './types';

// Generation executors never dispatch NODE_RUNNING themselves -- that transition is driven by
// the backend's own 'job.running' SSE event (simulated latency happens server-side), via the
// same applySseEvent handler reconciliation uses after a refresh.
export const textToImageExecutor: Executor = {
  run(ctx: ExecutorContext): Promise<MediaRef> {
    return runGenerationJob(ctx, 'textToImage', []);
  },
};
