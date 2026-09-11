import { useState } from 'react';
import { executorsByNodeType } from '../orchestrator/executors';
import { runGraph, terminalNodeIds } from '../orchestrator/runGraph';
import { useGraph } from '../state/graphContext';

export function RunButton() {
  const { dispatch, getGraph } = useGraph();
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = async () => {
    setIsRunning(true);
    try {
      await runGraph(terminalNodeIds(getGraph()), { getGraph, dispatch, executors: executorsByNodeType });
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <button onClick={() => void handleRun()} disabled={isRunning} type="button">
      {isRunning ? 'Running…' : 'Run'}
    </button>
  );
}
