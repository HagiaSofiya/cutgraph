import { useRef, useState } from 'react';
import { executorsByNodeType } from '../orchestrator/executors';
import { runGraph, terminalNodeIds } from '../orchestrator/runGraph';
import { useGraph } from '../state/graphContext';

export function RunButton() {
  const { dispatch, getGraph } = useGraph();
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleRun = async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    try {
      await runGraph(terminalNodeIds(getGraph()), {
        getGraph,
        dispatch,
        executors: executorsByNodeType,
        signal: controller.signal,
      });
    } finally {
      abortRef.current = null;
      setIsRunning(false);
    }
  };

  return (
    <>
      <button onClick={() => void handleRun()} disabled={isRunning} type="button">
        {isRunning ? 'Running…' : 'Run'}
      </button>
      {isRunning && (
        <button onClick={() => abortRef.current?.abort()} type="button">
          Stop
        </button>
      )}
    </>
  );
}
