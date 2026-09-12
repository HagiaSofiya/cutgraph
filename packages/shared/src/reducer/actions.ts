import type { Graph, GraphEdge, MediaRef, NodeFailure, NodeType } from '../types';

export type GraphAction =
  | { type: 'NODE_ADDED'; nodeId: string; nodeType: NodeType; position: { x: number; y: number }; params: unknown }
  | { type: 'NODE_REMOVED'; nodeId: string }
  | { type: 'NODE_MOVED'; nodeId: string; position: { x: number; y: number } }
  | { type: 'EDGE_ADDED'; edge: GraphEdge }
  | { type: 'EDGE_REMOVED'; edgeId: string }
  | { type: 'PARAM_CHANGED'; nodeId: string; params: unknown }
  | { type: 'NODE_QUEUED'; nodeId: string; cacheKey: string }
  | { type: 'NODE_RUNNING'; nodeId: string; cacheKey: string; jobId?: string }
  | { type: 'NODE_SUCCEEDED'; nodeId: string; cacheKey: string; result: MediaRef }
  | { type: 'NODE_FAILED'; nodeId: string; cacheKey: string; error: NodeFailure }
  | { type: 'NODE_RETRY'; nodeId: string }
  | { type: 'HYDRATE_FROM_STORAGE'; graph: Graph };

export const actions = {
  nodeAdded: (
    nodeId: string,
    nodeType: NodeType,
    position: { x: number; y: number },
    params: unknown,
  ): GraphAction => ({ type: 'NODE_ADDED', nodeId, nodeType, position, params }),

  nodeRemoved: (nodeId: string): GraphAction => ({ type: 'NODE_REMOVED', nodeId }),

  nodeMoved: (nodeId: string, position: { x: number; y: number }): GraphAction => ({
    type: 'NODE_MOVED',
    nodeId,
    position,
  }),

  edgeAdded: (edge: GraphEdge): GraphAction => ({ type: 'EDGE_ADDED', edge }),

  edgeRemoved: (edgeId: string): GraphAction => ({ type: 'EDGE_REMOVED', edgeId }),

  paramChanged: (nodeId: string, params: unknown): GraphAction => ({
    type: 'PARAM_CHANGED',
    nodeId,
    params,
  }),

  nodeQueued: (nodeId: string, cacheKey: string): GraphAction => ({
    type: 'NODE_QUEUED',
    nodeId,
    cacheKey,
  }),

  nodeRunning: (nodeId: string, cacheKey: string, jobId?: string): GraphAction => ({
    type: 'NODE_RUNNING',
    nodeId,
    cacheKey,
    jobId,
  }),

  nodeSucceeded: (nodeId: string, cacheKey: string, result: MediaRef): GraphAction => ({
    type: 'NODE_SUCCEEDED',
    nodeId,
    cacheKey,
    result,
  }),

  nodeFailed: (nodeId: string, cacheKey: string, error: NodeFailure): GraphAction => ({
    type: 'NODE_FAILED',
    nodeId,
    cacheKey,
    error,
  }),

  nodeRetry: (nodeId: string): GraphAction => ({ type: 'NODE_RETRY', nodeId }),

  hydrateFromStorage: (graph: Graph): GraphAction => ({ type: 'HYDRATE_FROM_STORAGE', graph }),
};
