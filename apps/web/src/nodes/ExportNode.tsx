import { actions, type ExportParams } from '@cutgraph/shared';
import type { NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { useGraph } from '../state/graphContext';
import { NodeShell } from './NodeShell';
import type { CutgraphNode } from '../canvas/types';

function ExportNodeImpl({ id, data }: NodeProps<CutgraphNode>) {
  const { dispatch } = useGraph();
  const node = data.node;
  const params = node.params as ExportParams;

  return (
    <NodeShell
      id={id}
      title="Export"
      status={node.status}
      errorMessage={node.error?.message}
      targetHandles={[{ id: null }]}
      hasSourceHandle={false}
    >
      <input
        type="text"
        value={params.filename ?? 'cutgraph-export.mp4'}
        onChange={(e) => dispatch(actions.paramChanged(id, { ...params, filename: e.target.value }))}
        style={{ width: '100%' }}
      />
      {node.status === 'succeeded' && <div style={{ marginTop: 6, color: '#22c55e' }}>Downloaded</div>}
    </NodeShell>
  );
}

export const ExportNode = memo(ExportNodeImpl);
