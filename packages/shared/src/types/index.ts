export type NodeType =
  | 'imageInput'
  | 'textToImage'
  | 'imageToVideo'
  | 'trim'
  | 'concat'
  | 'export';

export type NodeStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed' | 'stale';

// Why a generation failed, in the only vocabulary that crosses the wire. The point is not to
// enumerate every error -- it's that "retrying this unchanged might work" (RATE_LIMIT, TIMEOUT)
// and "it never will until you change something" (MODERATION, AUTH, SPEND_LIMIT) are different
// situations that used to reach the UI as identical red text with an identical Retry button.
// An absent code means "unknown failure", which every client already had to handle.
export const FAILURE_CODES = [
  'MODERATION',
  'RATE_LIMIT',
  'TIMEOUT',
  'AUTH',
  'TASK_FAILED',
  'INPUT_TOO_LARGE',
  'SPEND_LIMIT',
  'CANCELED',
  'SIMULATED_FAILURE',
] as const;

export type FailureCode = (typeof FAILURE_CODES)[number];

export interface NodeFailure {
  message: string;
  code?: FailureCode;
}

export interface MediaRef {
  id: string; // == the cacheKey that produced it
  kind: 'image' | 'video';
  url: string;
  durability: 'persistent' | 'ephemeral'; // persistent survives reload; ephemeral is a blob: URL
  posterUrl?: string;
  durationSec?: number;
  width?: number;
  height?: number;
  // Present only for an uploaded ImageInput (the upload endpoint returns it). A generation
  // node's output has no client-known hash -- the fixture/real adapter picked or produced it
  // server-side. Lets a downstream generation node's MediaInputRef stay honest rather than
  // sending a placeholder hash.
  sha256?: string;
}

export interface GraphNode<P = unknown> {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  params: P; // Zod-validated before it ever reaches the reducer
  status: NodeStatus;
  result?: MediaRef; // last succeeded output, retained through 'stale' and 'failed'
  cacheKey?: string; // key of the run that produced `result`, or of the in-flight run
  error?: NodeFailure & { at: number };
  jobId?: string; // generation nodes only, while queued or running
  updatedAt: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
  targetHandle?: string | null;
}

export interface Graph {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
  resultCache: Record<string, MediaRef>; // cacheKey -> output, independent of which node points at it
}

export function emptyGraph(): Graph {
  return { nodes: {}, edges: {}, resultCache: {} };
}
