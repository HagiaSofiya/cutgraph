import { describe, expect, it } from 'vitest';
import { actions, graphReducer } from '@cutgraph/shared';
import { emptyGraph } from '@cutgraph/shared';
import { makeGraph, makeNode, makeResult } from './helpers';
import {
  GRAPH_HISTORY_LIMIT,
  GraphHistory,
  graphDocumentFromGraph,
  isGraphEditAction,
} from '../src/state/graphHistory';

describe('GraphHistory', () => {
  it('tracks node, edge, parameter, move, remove, and graph replacement edits', () => {
    const editActions = [
      actions.nodeAdded('n', 'trim', { x: 0, y: 0 }, {}),
      actions.nodeMoved('n', { x: 1, y: 2 }),
      actions.nodesMoved([{ nodeId: 'n', position: { x: 1, y: 2 } }]),
      actions.nodeRemoved('n'),
      actions.edgeAdded({ id: 'e', source: 'a', target: 'b' }),
      actions.edgeRemoved('e'),
      actions.paramChanged('n', { start: 1 }),
      actions.hydrateFromStorage(emptyGraph()),
    ];
    for (const action of editActions) expect(isGraphEditAction(action)).toBe(true);
    expect(isGraphEditAction(actions.nodeQueued('n', 'key'))).toBe(false);
    expect(isGraphEditAction(actions.nodeSucceeded('n', 'key', { id: 'key', kind: 'video', url: '', durability: 'persistent' }))).toBe(false);
  });

  it('undoes and redoes graph documents without keeping runtime fields in snapshots', () => {
    const beforeGraph = makeGraph([makeNode({ id: 'n', status: 'succeeded', result: makeResult('r') })]);
    const afterGraph = graphReducer(beforeGraph, actions.nodeMoved('n', { x: 10, y: 20 }));
    const history = new GraphHistory();
    history.record(graphDocumentFromGraph(beforeGraph), graphDocumentFromGraph(afterGraph), actions.nodeMoved('n', { x: 10, y: 20 }));

    expect(history.canUndo).toBe(true);
    expect(history.undo()?.nodes.n.position).toEqual({ x: 0, y: 0 });
    expect(history.canRedo).toBe(true);
    const redone = history.redo();
    expect(redone?.nodes.n.position).toEqual({ x: 10, y: 20 });
    expect('status' in (redone?.nodes.n ?? {})).toBe(false);
  });

  it('coalesces rapid changes to the same parameter but keeps another parameter separate', () => {
    const history = new GraphHistory();
    const initial = makeGraph([makeNode({ id: 'n', params: { prompt: '', ratio: '1:1' } })]);
    const promptOne = graphReducer(initial, actions.paramChanged('n', { prompt: 'a', ratio: '1:1' }));
    const promptTwo = graphReducer(promptOne, actions.paramChanged('n', { prompt: 'ab', ratio: '1:1' }));
    const ratioChanged = graphReducer(promptTwo, actions.paramChanged('n', { prompt: 'ab', ratio: '16:9' }));

    history.record(graphDocumentFromGraph(initial), graphDocumentFromGraph(promptOne), actions.paramChanged('n', { prompt: 'a', ratio: '1:1' }), 100);
    history.record(graphDocumentFromGraph(promptOne), graphDocumentFromGraph(promptTwo), actions.paramChanged('n', { prompt: 'ab', ratio: '1:1' }), 450);
    history.record(graphDocumentFromGraph(promptTwo), graphDocumentFromGraph(ratioChanged), actions.paramChanged('n', { prompt: 'ab', ratio: '16:9' }), 600);

    expect(history.undoDepth).toBe(2);
    expect(history.undo()?.nodes.n.params).toEqual({ prompt: 'ab', ratio: '1:1' });
    expect(history.undo()?.nodes.n.params).toEqual({ prompt: '', ratio: '1:1' });
  });

  it('starts a new branch after undo and caps history at 50 entries', () => {
    const history = new GraphHistory();
    const initial = emptyGraph();
    const first = graphReducer(initial, actions.nodeAdded('first', 'trim', { x: 0, y: 0 }, {}));
    history.record(graphDocumentFromGraph(initial), graphDocumentFromGraph(first), actions.nodeAdded('first', 'trim', { x: 0, y: 0 }, {}), 0);
    expect(history.undo()).toEqual(graphDocumentFromGraph(initial));

    history.record(
      graphDocumentFromGraph(initial),
      graphDocumentFromGraph(graphReducer(initial, actions.nodeAdded('branch', 'trim', { x: 0, y: 0 }, {}))),
      actions.nodeAdded('branch', 'trim', { x: 0, y: 0 }, {}),
      1,
    );
    expect(history.canRedo).toBe(false);

    let graph = initial;
    const cappedHistory = new GraphHistory();
    for (let i = 0; i < GRAPH_HISTORY_LIMIT + 3; i++) {
      const action = actions.nodeAdded(`node-${i}`, 'trim', { x: i, y: 0 }, {});
      const next = graphReducer(graph, action);
      cappedHistory.record(graphDocumentFromGraph(graph), graphDocumentFromGraph(next), action, i * 1000);
      graph = next;
    }
    expect(cappedHistory.undoDepth).toBe(GRAPH_HISTORY_LIMIT);
  });
});
