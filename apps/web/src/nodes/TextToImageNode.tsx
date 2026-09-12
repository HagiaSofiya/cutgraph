import { actions, type TextToImageParams } from '@cutgraph/shared';
import type { NodeProps } from '@xyflow/react';
import { memo, useState } from 'react';
import { useGraph } from '../state/graphContext';
import { MediaPreview } from './MediaPreview';
import { NodeShell } from './NodeShell';
import type { CutgraphNode } from '../canvas/types';

const RATIOS = ['1:1', '16:9', '9:16', '4:3'] as const;

function TextToImageNodeImpl({ id, data, selected }: NodeProps<CutgraphNode>) {
  const { dispatch } = useGraph();
  const [isHovered, setIsHovered] = useState(false);
  const node = data.node;
  const params = node.params as TextToImageParams;

  const update = (patch: Partial<TextToImageParams>) => {
    dispatch(actions.paramChanged(id, { ...params, ...patch }));
  };

  return (
    <div onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <NodeShell id={id} title="Text to Image" status={node.status} error={node.error} hasSourceHandle>
        <textarea
          value={params.prompt ?? ''}
          onChange={(e) => update({ prompt: e.target.value })}
          placeholder="Describe the image..."
          rows={2}
          style={{ width: '100%' }}
        />
        <select value={params.ratio ?? '1:1'} onChange={(e) => update({ ratio: e.target.value as TextToImageParams['ratio'] })}>
          {RATIOS.map((ratio) => (
            <option key={ratio} value={ratio}>
              {ratio}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 8 }}>
          <MediaPreview result={node.result} isActive={isHovered || selected} />
        </div>
      </NodeShell>
    </div>
  );
}

export const TextToImageNode = memo(TextToImageNodeImpl);
