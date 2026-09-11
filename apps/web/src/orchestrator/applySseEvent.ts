import { actions } from '@cutgraph/shared';
import type { GraphAction, JobResult, MediaRef, SseEvent } from '@cutgraph/shared';
import type { Dispatch } from 'react';

export function mediaRefFromJobResult(cacheKey: string, result: JobResult): MediaRef {
  return {
    id: cacheKey,
    kind: result.kind,
    url: result.url,
    durability: 'persistent',
    durationSec: result.durationSec,
    width: result.width,
    height: result.height,
  };
}

// Shared between generation executors (as their SSE events arrive live) and boot-time
// reconciliation (replaying a job's history after a refresh) -- one place decides how an SSE
// event becomes a reducer action, so the two call sites can never drift out of sync.
export function applySseEvent(dispatch: Dispatch<GraphAction>, nodeId: string, event: SseEvent): void {
  switch (event.event) {
    case 'job.queued':
      // The node is already 'queued' locally the moment its executor calls createJob();
      // nothing new to reflect here.
      return;
    case 'job.running':
      dispatch(actions.nodeRunning(nodeId, event.data.cacheKey, event.data.jobId));
      return;
    case 'job.succeeded':
      dispatch(actions.nodeSucceeded(nodeId, event.data.cacheKey, mediaRefFromJobResult(event.data.cacheKey, event.data.result)));
      return;
    case 'job.failed':
      dispatch(actions.nodeFailed(nodeId, event.data.cacheKey, event.data.error));
      return;
  }
}
