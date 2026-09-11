import { actions } from '@cutgraph/shared';
import type { Graph, GraphAction, JobStatusResponse, SseEvent } from '@cutgraph/shared';
import type { Dispatch } from 'react';
import { getJobStatus } from '../api/client';
import { subscribeToJob } from '../api/sse';
import { applySseEvent } from '../orchestrator/applySseEvent';

function toTerminalEvent(status: JobStatusResponse): SseEvent {
  if (status.status === 'succeeded') {
    return {
      id: 2,
      event: 'job.succeeded',
      data: { jobId: status.jobId, cacheKey: status.cacheKey, at: status.updatedAt, result: status.result! },
    };
  }
  return {
    id: 2,
    event: 'job.failed',
    data: { jobId: status.jobId, cacheKey: status.cacheKey, at: status.updatedAt, error: status.error! },
  };
}

// Runs once at boot, after hydrating the graph from localStorage. Every node still
// queued/running with a jobId (persistence only keeps that combination when it's actually
// reconcilable -- see sanitizeNodeForStorage) gets its current truth fetched from the server:
// terminal already -> apply it directly; still in flight -> resume live SSE. Everything here
// goes through applySseEvent, the same function generation executors use, so a duplicate or
// already-applied transition is a safe no-op via the reducer's own preconditions.
export async function reconcileInFlightJobs(graph: Graph, dispatch: Dispatch<GraphAction>): Promise<void> {
  const pending = Object.values(graph.nodes).filter(
    (node) => (node.status === 'queued' || node.status === 'running') && node.jobId !== undefined,
  );

  await Promise.all(
    pending.map(async (node) => {
      const jobId = node.jobId!;
      const status = await getJobStatus(jobId);

      if (!status) {
        dispatch(actions.nodeFailed(node.id, node.cacheKey ?? '', { message: 'Job lost (server restarted or expired)' }));
        return;
      }

      if (status.status === 'succeeded' || status.status === 'failed') {
        // Bring a still-'queued' node through 'running' first, in case the live 'running'
        // event was never observed locally (e.g. the tab was closed before it arrived) --
        // otherwise the terminal transition's own precondition would reject it.
        dispatch(actions.nodeRunning(node.id, status.cacheKey));
        applySseEvent(dispatch, node.id, toTerminalEvent(status));
        return;
      }

      subscribeToJob(jobId, { onEvent: (event) => applySseEvent(dispatch, node.id, event) });
    }),
  );
}
