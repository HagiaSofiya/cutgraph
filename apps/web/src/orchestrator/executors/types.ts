import type { GraphAction, GraphNode, MediaRef } from '@cutgraph/shared';
import type { Dispatch } from 'react';

export interface ExecutorContext {
  node: GraphNode;
  upstream: MediaRef[]; // resolved in incoming-edge (handle-sorted) order
  cacheKey: string;
  dispatch: Dispatch<GraphAction>;
}

export interface Executor {
  run(ctx: ExecutorContext): Promise<MediaRef>;
}
