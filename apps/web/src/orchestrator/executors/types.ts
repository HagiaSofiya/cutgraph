import type { GraphAction, GraphNode, MediaRef } from '@cutgraph/shared';
import type { Dispatch } from 'react';

export interface ExecutorContext {
  node: GraphNode;
  upstream: MediaRef[]; // resolved in incoming-edge (handle-sorted) order
  cacheKey: string;
  dispatch: Dispatch<GraphAction>;
  // Aborted when the user stops the run. Generation executors use it to stop the remote task;
  // the client-side (mediabunny) ones cannot interrupt an encode in progress, so for them this
  // only prevents work that hasn't started yet.
  signal?: AbortSignal;
}

export interface Executor {
  run(ctx: ExecutorContext): Promise<MediaRef>;
}
