import { actions, DEFAULT_IMAGE_TO_VIDEO_MODEL, DEFAULT_TEXT_TO_IMAGE_MODEL } from '@cutgraph/shared';
import type { NodeType } from '@cutgraph/shared';
import { useReactFlow } from '@xyflow/react';
import { useGraph } from '../state/graphContext';
import { createSampleGraph } from '../state/sampleGraph';
import { RunButton } from './RunButton';
import { AdapterBadge } from './AdapterBadge';

const DEFAULT_PARAMS: Record<NodeType, Record<string, unknown>> = {
  imageInput: { sourceName: '', sourceSize: 0, sourceLastModified: 0 },
  textToImage: { prompt: '', ratio: '1:1', model: DEFAULT_TEXT_TO_IMAGE_MODEL },
  imageToVideo: { prompt: '', duration: 4, ratio: '16:9', model: DEFAULT_IMAGE_TO_VIDEO_MODEL },
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
  const { dispatch, getGraph } = useGraph();
  const { fitView } = useReactFlow();

  const addNode = (type: NodeType) => {
    addCount += 1;
    const id = `${type}-${crypto.randomUUID()}`;
    const position = { x: 80 + (addCount % 6) * 260, y: 80 + Math.floor(addCount / 6) * 220 };
    dispatch(actions.nodeAdded(id, type, position, DEFAULT_PARAMS[type]));
  };

  const loadSample = () => {
    // Wholesale replace, and the save effect writes it straight through to localStorage -- so
    // ask before throwing away work.
    const hasWork = Object.keys(getGraph().nodes).length > 0;
    if (hasWork && !window.confirm('Replace the current graph with the sample pipeline?')) return;

    dispatch(actions.hydrateFromStorage(createSampleGraph()));
    // The new graph only reaches xyflow's store via useSyncNodeData's effect, so a synchronous
    // fitView() here would fit the nodes we just replaced.
    requestAnimationFrame(() => void fitView());
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
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={loadSample}>
          Load sample
        </button>
        <RunButton />
      </div>
    </div>
  );
}
