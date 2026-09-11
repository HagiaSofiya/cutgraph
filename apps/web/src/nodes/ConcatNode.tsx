import type { NodeProps } from '@xyflow/react';
import { memo, useState } from 'react';
import { MediaPreview } from './MediaPreview';
import { NodeShell } from './NodeShell';
import type { CutgraphNode } from '../canvas/types';

const CONCAT_HANDLES = [
  { id: 'in-0', label: '1' },
  { id: 'in-1', label: '2' },
  { id: 'in-2', label: '3' },
  { id: 'in-3', label: '4' },
];

function ConcatNodeImpl({ id, data, selected }: NodeProps<CutgraphNode>) {
  const [isHovered, setIsHovered] = useState(false);
  const node = data.node;

  return (
    <div onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <NodeShell
        id={id}
        title="Concat"
        status={node.status}
        errorMessage={node.error?.message}
        targetHandles={CONCAT_HANDLES}
        hasSourceHandle
      >
        <div style={{ color: '#aaa' }}>Up to 4 ordered inputs (top to bottom)</div>
        <div style={{ marginTop: 8 }}>
          <MediaPreview result={node.result} isActive={isHovered || selected} />
        </div>
      </NodeShell>
    </div>
  );
}

export const ConcatNode = memo(ConcatNodeImpl);
