import { CycleError, downstreamOf, selectRunPlan } from '@cutgraph/shared';
import type { Graph, HealthResponse, RunPlan } from '@cutgraph/shared';
import { useMemo, useRef, useState } from 'react';
import { getHealth } from '../api/client';
import { executorsByNodeType } from '../orchestrator/executors';
import { runGraph, terminalNodeIds } from '../orchestrator/runGraph';
import { useGraph } from '../state/graphContext';

// 'graph' targets every terminal node. The other two exist because a generation costs money:
// re-running one branch should not mean paying for the others. runGraph has always accepted an
// arbitrary target list -- only a way to pick one was missing.
export type RunScope = 'graph' | 'selection' | 'downstream';

// Undefined means "the whole graph", which RunButton resolves to its terminal nodes. Whatever
// comes back, topoSort expands it with every ancestor, so a scope only ever narrows what runs
// *after* the selection, never what it depends on.
export function runTargetsForScope(
  graph: Graph,
  scope: RunScope,
  selectedNodeIds: string[],
): string[] | undefined {
  if (scope === 'graph' || selectedNodeIds.length === 0) return undefined;
  if (scope === 'selection') return selectedNodeIds;
  return [...new Set(selectedNodeIds.flatMap((id) => [id, ...downstreamOf(graph, id)]))].sort();
}

// The four numbers that change what a user would do next: work that costs money, work that does
// not, work already paid for, and work that cannot start at all.
export function summarizePlan(plan: RunPlan): string {
  const parts: string[] = [];
  if (plan.generations > 0) parts.push(`${plan.generations} to generate`);
  if (plan.clientSide > 0) parts.push(`${plan.clientSide} local`);
  if (plan.cached > 0) parts.push(`${plan.cached} cached`);
  if (plan.blocked > 0) parts.push(`${plan.blocked} blocked`);
  return parts.length > 0 ? parts.join(' · ') : 'up to date';
}

// The text of the "you are about to spend money" prompt, or undefined when there is nothing to
// warn about. Split out from the component so the interesting part -- which runs get gated, and
// what the budget arithmetic says -- is testable without a DOM confirm.
export function spendConfirmation(plan: RunPlan, health: HealthResponse | undefined): string | undefined {
  // Fixture mode returns canned clips; only the real adapter can bill anyone. An unreachable
  // server leaves `health` undefined, and a run that cannot reach the server cannot spend.
  if (plan.generations === 0 || health?.adapter.active !== 'runway') return undefined;

  const { generationsUsed, maxGenerationsTotal } = health.limits;
  const remaining =
    maxGenerationsTotal === null ? undefined : Math.max(0, maxGenerationsTotal - generationsUsed);

  const lines = [
    `This run makes ${plan.generations} real generation${plan.generations === 1 ? '' : 's'} via Runway.`,
  ];
  if (plan.cached > 0) {
    lines.push(`${plan.cached} node${plan.cached === 1 ? ' is' : 's are'} a free cache hit.`);
  }
  if (remaining !== undefined) {
    lines.push(
      remaining < plan.generations
        ? `Only ${remaining} of the server's generation budget remain, so ${plan.generations - remaining} would fail with a spend-limit error.`
        : `${remaining} of the server's generation budget remain.`,
    );
  }
  lines.push('', 'Continue?');
  return lines.join('\n');
}

interface RunButtonProps {
  // Which nodes to run towards. Undefined means every terminal node -- the whole graph.
  targetNodeIds?: string[];
}

export function RunButton({ targetNodeIds }: RunButtonProps) {
  const { graph, dispatch, getGraph } = useGraph();
  const [isRunning, setIsRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // A cycle is reachable: EDGE_ADDED only checks that both endpoints exist and the target handle
  // is free, so topoSort can throw here. Before this button previewed anything that throw landed
  // inside an async handler and merely made Run do nothing; computing a plan during render would
  // have taken the whole canvas down with it.
  const plan = useMemo(() => {
    try {
      return selectRunPlan(graph, targetNodeIds ?? terminalNodeIds(graph));
    } catch (err) {
      if (err instanceof CycleError) return undefined;
      throw err;
    }
  }, [graph, targetNodeIds]);

  const willDoWork = plan !== undefined && plan.generations + plan.clientSide > 0;

  const handleRun = async () => {
    const targets = targetNodeIds ?? terminalNodeIds(getGraph());
    if (plan) {
      // Fetched at click time rather than reused from the badge's mount-time copy: the number
      // this prompt quotes is the one the user is deciding against, so a stale count would be
      // worse than none.
      const health = await getHealth().catch(() => undefined);
      const confirmation = spendConfirmation(plan, health);
      if (confirmation && !window.confirm(confirmation)) return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsRunning(true);
    try {
      await runGraph(targets, {
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

  const disabledTitle =
    plan === undefined
      ? 'This graph has a cycle, so there is no order to run it in.'
      : 'Nothing to run: every node is already up to date, or is waiting on one that is.';

  return (
    <>
      <span style={{ fontSize: 11, opacity: 0.7, whiteSpace: 'nowrap' }}>
        {plan === undefined ? 'cycle' : summarizePlan(plan)}
      </span>
      <button
        onClick={() => void handleRun()}
        disabled={isRunning || !willDoWork}
        title={willDoWork ? undefined : disabledTitle}
        type="button"
      >
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
