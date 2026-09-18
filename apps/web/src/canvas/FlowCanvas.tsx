import { actions } from '@cutgraph/shared';
import {
  Background,
  Controls,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback } from 'react';
import { useGraph } from '../state/graphContext';
import { makeEdgeId } from './edgeId';
import { nodeTypes } from './nodeTypes';
import { useGraphClipboard } from './useGraphClipboard';
import type { CutgraphNode } from './types';
import { useSyncNodeData } from './useSyncNodeData';

export function FlowCanvas() {
  const { graph, dispatch } = useGraph();
  const [nodes, setNodes, onNodesChangeInternal] = useNodesState<CutgraphNode>([]);
  const [edges, setEdges, onEdgesChangeInternal] = useEdgesState<Edge>([]);

  useSyncNodeData(graph);
  useGraphClipboard();

  const handleNodesChange = useCallback(
    (changes: NodeChange<CutgraphNode>[]) => {
      onNodesChangeInternal(changes);
      // React Flow reports each selected node's final position separately. Keep one move action
      // so a drag of a multi-selection is a single undo step.
      const moved = changes.flatMap((change) =>
        change.type === 'position' && change.position && change.dragging === false
          ? [{ nodeId: change.id, position: change.position }]
          : [],
      );
      if (moved.length > 0) dispatch(actions.nodesMoved(moved));
      for (const change of changes) {
        if (change.type === 'remove') dispatch(actions.nodeRemoved(change.id));
      }
    },
    [onNodesChangeInternal, dispatch],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      onEdgesChangeInternal(changes);
      for (const change of changes) {
        if (change.type === 'remove') dispatch(actions.edgeRemoved(change.id));
      }
    },
    [onEdgesChangeInternal, dispatch],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const id = makeEdgeId(connection.source, connection.sourceHandle, connection.target, connection.targetHandle);
      dispatch(
        actions.edgeAdded({
          id,
          source: connection.source,
          target: connection.target,
          sourceHandle: connection.sourceHandle,
          targetHandle: connection.targetHandle,
        }),
      );
    },
    [dispatch],
  );

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
