import { actions, type ImageToVideoParams } from '@cutgraph/shared';
import type { NodeProps } from '@xyflow/react';
import { memo, useState } from 'react';
import { useGraph } from '../state/graphContext';
import { MediaPreview } from './MediaPreview';
import { NodeShell } from './NodeShell';
import type { CutgraphNode } from '../canvas/types';

const RATIOS = ['1:1', '16:9', '9:16', '4:3'] as const;

function ImageToVideoNodeImpl({ id, data, selected }: NodeProps<CutgraphNode>) {
  const { dispatch } = useGraph();
  const [isHovered, setIsHovered] = useState(false);
  const node = data.node;
  const params = node.params as ImageToVideoParams;

  const update = (patch: Partial<ImageToVideoParams>) => {
    dispatch(actions.paramChanged(id, { ...params, ...patch }));
  };

  return (
    <div onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <NodeShell
        id={id}
        title="Image to Video"
        status={node.status}
        errorMessage={node.error?.message}
        targetHandles={[{ id: null }]}
        hasSourceHandle
      >
        <textarea
          value={params.prompt ?? ''}
          onChange={(e) => update({ prompt: e.target.value })}
          placeholder="Describe the motion..."
          rows={2}
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <select value={params.ratio ?? '16:9'} onChange={(e) => update({ ratio: e.target.value as ImageToVideoParams['ratio'] })}>
            {RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={2}
            max={10}
            value={params.duration ?? 4}
            onChange={(e) => update({ duration: Number(e.target.value) })}
            style={{ width: 60 }}
          />
          <span>sec</span>
        </div>
        <div style={{ marginTop: 8 }}>
          <MediaPreview result={node.result} isActive={isHovered || selected} />
        </div>
      </NodeShell>
    </div>
  );
}

export const ImageToVideoNode = memo(ImageToVideoNodeImpl);
