import { actions } from '@cutgraph/shared';
import type { NodeType } from '@cutgraph/shared';
import { useGraph } from '../state/graphContext';
import { RunButton } from './RunButton';
import { AdapterBadge } from './AdapterBadge';

const DEFAULT_PARAMS: Record<NodeType, Record<string, unknown>> = {
  imageInput: { sourceName: '', sourceSize: 0, sourceLastModified: 0 },
  textToImage: { prompt: '', ratio: '1:1' },
  imageToVideo: { prompt: '', duration: 4, ratio: '16:9' },
  trim: { start: 0, end: 1 },
  concat: {},
  export: { filename: 'cutgraph-export.mp4' },
};

const LABELS: Record<NodeType, string> = {
  imageInput: 'Image Input',
  textToImage: 'Text to Image',
  imageToVideo: 'Image to Video',
  trim: 'Trim',
  concat: 'Concat',
  export: 'Export',
};

let addCount = 0;

export function Toolbar() {
  const { dispatch } = useGraph();

  const addNode = (type: NodeType) => {
    addCount += 1;
    const id = `${type}-${crypto.randomUUID()}`;
    const position = { x: 80 + (addCount % 6) * 260, y: 80 + Math.floor(addCount / 6) * 220 };
    dispatch(actions.nodeAdded(id, type, position, DEFAULT_PARAMS[type]));
  };

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: 10,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        alignItems: 'center',
      }}
    >
      <AdapterBadge />
      {(Object.keys(LABELS) as NodeType[]).map((type) => (
        <button key={type} type="button" onClick={() => addNode(type)}>
          + {LABELS[type]}
        </button>
      ))}
      <div style={{ marginLeft: 'auto' }}>
        <RunButton />
      </div>
    </div>
  );
}
