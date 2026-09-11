import { actions, type ImageInputParams } from '@cutgraph/shared';
import type { NodeProps } from '@xyflow/react';
import { memo, useState } from 'react';
import { setPendingUpload } from '../media/blobStore';
import { useGraph } from '../state/graphContext';
import { MediaPreview } from './MediaPreview';
import { NodeShell } from './NodeShell';
import type { CutgraphNode } from '../canvas/types';

function ImageInputNodeImpl({ id, data, selected }: NodeProps<CutgraphNode>) {
  const { dispatch } = useGraph();
  const [isHovered, setIsHovered] = useState(false);
  const node = data.node;
  const params = node.params as ImageInputParams;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingUpload(id, file);
    dispatch(
      actions.paramChanged(id, {
        sourceName: file.name,
        sourceSize: file.size,
        sourceLastModified: file.lastModified,
      }),
    );
  };

  return (
    <div onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <NodeShell id={id} title="Image Input" status={node.status} errorMessage={node.error?.message} hasSourceHandle>
        <input type="file" accept="image/*" onChange={handleFileChange} />
        {params.sourceName && <div style={{ marginTop: 6, color: '#aaa' }}>{params.sourceName}</div>}
        <div style={{ marginTop: 8 }}>
          <MediaPreview result={node.result} isActive={isHovered || selected} />
        </div>
      </NodeShell>
    </div>
  );
}

export const ImageInputNode = memo(ImageInputNodeImpl);
