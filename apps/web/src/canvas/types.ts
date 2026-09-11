import type { GraphNode } from '@cutgraph/shared';
import type { Node } from '@xyflow/react';

// xyflow's Node.data must be a plain Record; wrapping the whole logical node under one key
// keeps this a single object whose reference only changes when the node itself does, which is
// exactly the signal useSyncNodeData's diff relies on to skip untouched nodes.
export interface CutgraphNodeData extends Record<string, unknown> {
  node: GraphNode;
}

export type CutgraphNode = Node<CutgraphNodeData>;
