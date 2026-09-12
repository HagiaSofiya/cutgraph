import { graphReducer } from '@cutgraph/shared';
import type { Graph, GraphAction } from '@cutgraph/shared';
import { createContext, useContext, useEffect, useReducer, useRef, type Dispatch, type ReactNode } from 'react';
import { loadGraph, saveGraph } from './persistence';
import { reconcileInFlightJobs } from './reconciliation';
import { createSampleGraph } from './sampleGraph';

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

  const dispatchRef = useRef((action: GraphAction) => {
    graphRef.current = graphReducer(graphRef.current, action);
    reactDispatch(action);
  });
  const getGraphRef = useRef(() => graphRef.current);

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
    <GraphContext.Provider value={{ graph, dispatch: dispatchRef.current, getGraph: getGraphRef.current }}>
      {children}
    </GraphContext.Provider>
  );
}

export function useGraph(): GraphContextValue {
  const ctx = useContext(GraphContext);
  if (!ctx) throw new Error('useGraph must be used within a GraphProvider');
  return ctx;
}
