import { actions, DEFAULT_IMAGE_TO_VIDEO_MODEL, DEFAULT_TEXT_TO_IMAGE_MODEL } from '@cutgraph/shared';
import type { NodeType } from '@cutgraph/shared';
import { useReactFlow } from '@xyflow/react';
import { useMemo, useRef, useState } from 'react';
import { useSelectedNodeIds } from '../canvas/useSelectedNodeIds';
import { triggerDownload } from '../media/mediabunnyClient';
import { useGraph } from '../state/graphContext';
import {
  GRAPH_FILE_NAME,
  graphFromDocument,
  imageInputCount,
  parseGraphFile,
  serializeGraphFile,
} from '../state/graphFile';
import { createSampleGraph } from '../state/sampleGraph';
import { RunButton, runTargetsForScope } from './RunButton';
import type { RunScope } from './RunButton';
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

const SCOPE_TITLE =
  'What Run targets. Whichever you pick, everything those nodes depend on is included; ' +
  'anything already up to date is skipped.';

export function Toolbar() {
  const { graph, dispatch, getGraph, canUndo, canRedo, undo, redo } = useGraph();
  const { fitView } = useReactFlow();
  const selectedNodeIds = useSelectedNodeIds();
  const [scope, setScope] = useState<RunScope>('graph');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived rather than reset through an effect: with nothing selected the scoped options mean
  // nothing, so Run falls back to the whole graph instead of silently targeting an empty set.
  // The stored choice survives, so clearing and re-selecting keeps the user's preference.
  const effectiveScope = selectedNodeIds.length === 0 ? 'graph' : scope;

  const runTargets = useMemo(
    () => runTargetsForScope(graph, effectiveScope, selectedNodeIds),
    [graph, effectiveScope, selectedNodeIds],
  );

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

    const sample = createSampleGraph();
    dispatch(
      actions.hydrateFromStorage({
        ...sample,
        resultCache: { ...getGraph().resultCache, ...sample.resultCache },
      }),
    );
    // The new graph only reaches xyflow's store via useSyncNodeData's effect, so a synchronous
    // fitView() here would fit the nodes we just replaced.
    requestAnimationFrame(() => void fitView());
  };

  const saveGraph = () => {
    triggerDownload(new Blob([serializeGraphFile(getGraph())], { type: 'application/json' }), GRAPH_FILE_NAME);
  };

  const openGraph = async (file: File) => {
    const parsed = parseGraphFile(await file.text());
    if (!parsed.ok) {
      window.alert(`Could not open ${file.name}.\n\n${parsed.error}`);
      return;
    }

    // Same wholesale replace as Load sample, and asked for on the same terms. Going through
    // HYDRATE_FROM_STORAGE rather than GRAPH_DOCUMENT_RESTORED is deliberate: only the former
    // is recorded in history, and replacing the whole canvas is exactly the edit a user is
    // most likely to want back.
    const uploads = imageInputCount(parsed.document);
    const warning = uploads > 0
      ? `\n\n${uploads} Image Input node${uploads === 1 ? '' : 's'} will need its file picked again -- ` +
        'uploads are not part of a saved graph.'
      : '';
    const hasWork = Object.keys(getGraph().nodes).length > 0;
    if (hasWork && !window.confirm(`Replace the current graph with ${file.name}?${warning}`)) return;

    dispatch(actions.hydrateFromStorage(graphFromDocument(parsed.document, getGraph().resultCache)));
    requestAnimationFrame(() => void fitView());
  };

  return (
    <div
      style={{
        display: 'flex',
        // Wraps rather than pushing Run off the right edge: this row now carries the adapter
        // badge, undo/redo, six add buttons, three graph-file controls and the run scope.
        flexWrap: 'wrap',
        gap: '6px 8px',
        padding: 10,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        alignItems: 'center',
      }}
    >
      <AdapterBadge />
      <button
        type="button"
        onClick={undo}
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo (⌘Z / Ctrl+Z)"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo (⌘⇧Z / Ctrl+Shift+Z)"
      >
        Redo
      </button>
      {(Object.keys(LABELS) as NodeType[]).map((type) => (
        <button key={type} type="button" onClick={() => addNode(type)}>
          + {LABELS[type]}
        </button>
      ))}
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={loadSample}>
          Load sample
        </button>
        <button type="button" onClick={saveGraph} title="Download this pipeline as a JSON file.">
          Save graph
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Open a pipeline saved with Save graph."
        >
          Open graph
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          aria-label="Open graph file"
          style={{ display: 'none' }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so picking the same file twice in a row still fires a change event.
            event.target.value = '';
            if (file) void openGraph(file);
          }}
        />
        {selectedNodeIds.length > 0 && (
          <select
            value={effectiveScope}
            onChange={(event) => setScope(event.target.value as RunScope)}
            aria-label="Run scope"
            title={SCOPE_TITLE}
          >
            <option value="graph">Whole graph</option>
            <option value="selection">Selection ({selectedNodeIds.length})</option>
            <option value="downstream">Selection + downstream</option>
          </select>
        )}
        <RunButton targetNodeIds={runTargets} />
      </div>
    </div>
  );
}
