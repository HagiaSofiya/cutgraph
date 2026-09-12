import { actions, type TrimParams } from '@cutgraph/shared';
import type { NodeProps } from '@xyflow/react';
import { memo, useState } from 'react';
import { useGraph } from '../state/graphContext';
import { MediaPreview } from './MediaPreview';
import { NodeShell } from './NodeShell';
import type { CutgraphNode } from '../canvas/types';

function TrimNodeImpl({ id, data, selected }: NodeProps<CutgraphNode>) {
  const { dispatch } = useGraph();
  const [isHovered, setIsHovered] = useState(false);
  const node = data.node;
  const params = node.params as TrimParams;

  const update = (patch: Partial<TrimParams>) => {
    dispatch(actions.paramChanged(id, { ...params, ...patch }));
  };

  return (
    <div onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <NodeShell
        id={id}
        title="Trim"
        status={node.status}
        error={node.error}
        targetHandles={[{ id: null }]}
        hasSourceHandle
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <label>start</label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={params.start ?? 0}
            onChange={(e) => update({ start: Number(e.target.value) })}
            style={{ width: 60 }}
          />
          <label>end</label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={params.end ?? 0}
            onChange={(e) => update({ end: Number(e.target.value) })}
            style={{ width: 60 }}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <MediaPreview result={node.result} isActive={isHovered || selected} />
        </div>
      </NodeShell>
    </div>
  );
}

export const TrimNode = memo(TrimNodeImpl);
