import type { Graph } from '@cutgraph/shared';
import { useReactFlow } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { reconcileFlowNodes } from './reconcileFlowNodes';
import type { CutgraphNode } from './types';

// The one place reducer state flows into the canvas. Structural edits (connect/drag/delete)
// flow the other way, straight from xyflow's own callbacks into `dispatch` -- see FlowCanvas.
export function useSyncNodeData(graph: Graph): void {
  const { setNodes, setEdges } = useReactFlow();
  const prevGraphRef = useRef<Graph | null>(null);

  useEffect(() => {
    const prevGraph = prevGraphRef.current;
    prevGraphRef.current = graph;

    setNodes((current) => reconcileFlowNodes(current as CutgraphNode[], graph, prevGraph));

    setEdges((current) => {
      const survivors = current.filter((edge) => graph.edges[edge.id] !== undefined);
      const existingIds = new Set(survivors.map((edge) => edge.id));
      const additions = Object.values(graph.edges)
        .filter((edge) => !existingIds.has(edge.id))
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle ?? undefined,
          targetHandle: edge.targetHandle ?? undefined,
        }));
      return additions.length === 0 ? survivors : [...survivors, ...additions];
    });
  }, [graph, setNodes, setEdges]);
}
