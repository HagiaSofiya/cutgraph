import { actions, graphReducer } from '@cutgraph/shared';
import type { Graph, GraphAction } from '@cutgraph/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from 'react';
import { loadGraph, saveGraph } from './persistence';
import { reconcileInFlightJobs } from './reconciliation';
import { createSampleGraph } from './sampleGraph';
import { GraphHistory, graphDocumentFromGraph, isGraphEditAction } from './graphHistory';

interface GraphContextValue {
  graph: Graph;
  // Synchronously applies the reducer to a ref *before* also telling React about it (see
  // dispatchRef below) -- runGraph dispatches a terminal action for one node, and the downstream
  // node waiting on it wakes in the very next microtask and calls getGraph(). React's own
  // dispatch only re-renders on its own schedule, so relying on it alone left getGraph()
  // returning a stale graph (an already-succeeded upstream still reading as not-ready) for
  // exactly that race.
  dispatch: Dispatch<GraphAction>;
  getGraph: () => Graph;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
}

const GraphContext = createContext<GraphContextValue | undefined>(undefined);

export function GraphProvider({ children }: { children: ReactNode }) {
  // The only hook point for "is this a first visit?": the saveGraph effect below writes the
  // storage key on mount, so from render #2 onward an absent key is indistinguishable from a
  // deliberately emptied canvas. An empty *stored* graph is still a stored graph, so a user who
  // cleared their nodes never gets the sample pushed back on them.
  const [graph, reactDispatch] = useReducer(graphReducer, undefined, () => loadGraph() ?? createSampleGraph());
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const historyRef = useRef(new GraphHistory());
  const [historyAvailability, setHistoryAvailability] = useState({ canUndo: false, canRedo: false });

  const syncHistoryAvailability = () => {
    setHistoryAvailability({ canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo });
  };

  const dispatchRef = useRef((action: GraphAction) => {
    const before = graphRef.current;
    const next = graphReducer(before, action);
    if (isGraphEditAction(action)) {
      const recorded = historyRef.current.record(
        graphDocumentFromGraph(before),
        graphDocumentFromGraph(next),
        action,
      );
      if (recorded) syncHistoryAvailability();
    }
    graphRef.current = next;
    reactDispatch(action);
  });
  const getGraphRef = useRef(() => graphRef.current);

  const undo = useCallback(() => {
    const document = historyRef.current.undo();
    if (!document) return;
    const action = actions.graphDocumentRestored(document);
    graphRef.current = graphReducer(graphRef.current, action);
    reactDispatch(action);
    syncHistoryAvailability();
  }, [reactDispatch]);

  const redo = useCallback(() => {
    const document = historyRef.current.redo();
    if (!document) return;
    const action = actions.graphDocumentRestored(document);
    graphRef.current = graphReducer(graphRef.current, action);
    reactDispatch(action);
    syncHistoryAvailability();
  }, [reactDispatch]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'z') return;
      if (isNativeTextEditingTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [redo, undo]);

  useEffect(() => {
    // Reconciles whatever was hydrated from storage at boot -- deliberately not re-run on
    // every subsequent graph change.
    void reconcileInFlightJobs(graphRef.current, dispatchRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    saveGraph(graph);
  }, [graph]);

  return (
    <GraphContext.Provider
      value={{
        graph,
        dispatch: dispatchRef.current,
        getGraph: getGraphRef.current,
        canUndo: historyAvailability.canUndo,
        canRedo: historyAvailability.canRedo,
        undo,
        redo,
      }}
    >
      {children}
    </GraphContext.Provider>
  );
}

function isNativeTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest('[contenteditable="true"]') !== null ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function useGraph(): GraphContextValue {
  const ctx = useContext(GraphContext);
  if (!ctx) throw new Error('useGraph must be used within a GraphProvider');
  return ctx;
}
