import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actions, emptyGraph } from '@cutgraph/shared';
import { GraphProvider, useGraph } from '../src/state/graphContext';

function HistoryHarness() {
  const { graph, dispatch, canUndo, canRedo, undo, redo } = useGraph();
  return (
    <>
      <button onClick={() => dispatch(actions.nodeAdded('added-node', 'trim', { x: 5, y: 6 }, {}))}>Add node</button>
      <button onClick={() => dispatch(actions.hydrateFromStorage(emptyGraph()))}>Replace graph</button>
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
      <input aria-label="Prompt" />
      <output data-testid="node-ids">{Object.keys(graph.nodes).sort().join(',')}</output>
    </>
  );
}

function renderHarness() {
  return render(
    <GraphProvider>
      <HistoryHarness />
    </GraphProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => cleanup());

describe('GraphProvider history controls', () => {
  it('handles Ctrl+Z and Ctrl+Shift+Z outside inputs while preserving native text-field shortcuts', async () => {
    renderHarness();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add node' }));
    expect(screen.getByTestId('node-ids').textContent).toContain('added-node');

    const inputKeyEvent = fireEvent.keyDown(screen.getByRole('textbox', { name: 'Prompt' }), {
      key: 'z',
      ctrlKey: true,
    });
    expect(inputKeyEvent).toBe(true);
    expect(screen.getByTestId('node-ids').textContent).toContain('added-node');

    const undoKeyEvent = fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(undoKeyEvent).toBe(false);
    await waitFor(() => expect(screen.getByTestId('node-ids').textContent).not.toContain('added-node'));
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();

    fireEvent.keyDown(document.body, { key: 'Z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByTestId('node-ids').textContent).toContain('added-node'));
  });

  it('treats Load sample graph replacement as one undoable edit', async () => {
    renderHarness();
    const originalIds = screen.getByTestId('node-ids').textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Replace graph' }));
    expect(screen.getByTestId('node-ids').textContent).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(screen.getByTestId('node-ids').textContent).toBe(originalIds));
    expect(screen.getByRole('button', { name: 'Redo' })).toBeEnabled();
  });

  it('persists the graph but starts with empty history after a provider remount', async () => {
    const first = renderHarness();
    fireEvent.click(screen.getByRole('button', { name: 'Add node' }));
    await waitFor(() => expect(localStorage.getItem('cutgraph:graph:v1')).toContain('added-node'));
    first.unmount();

    renderHarness();
    expect(screen.getByTestId('node-ids').textContent).toContain('added-node');
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
  });
});
