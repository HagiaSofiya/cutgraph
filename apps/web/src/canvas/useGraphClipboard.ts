import { actions } from '@cutgraph/shared';
import type { GraphDocument } from '@cutgraph/shared';
import { useEffect, useRef } from 'react';
import { copyNodes, PASTE_OFFSET, pasteFragment } from '../state/graphClipboard';
import { isNativeTextEditingTarget } from '../state/isNativeTextEditingTarget';
import { useGraph } from '../state/graphContext';
import { useSelectedNodeIds } from './useSelectedNodeIds';

// Matches the ids the toolbar's own add-node button mints.
function newNodeId(nodeType: string): string {
  return `${nodeType}-${crypto.randomUUID()}`;
}

// Cmd/Ctrl+C, +V and +D over the canvas. The clipboard is in-app and lasts as long as the tab:
// a pipeline that has to cross a tab boundary goes through Save graph, which is a real file with
// a validated format rather than whatever happens to be in the system clipboard.
export function useGraphClipboard(): void {
  const { dispatch, getGraph } = useGraph();
  const selectedNodeIds = useSelectedNodeIds();
  const clipboardRef = useRef<GraphDocument | null>(null);
  const pasteCountRef = useRef(0);

  // Held in a ref so the listener below is installed once rather than re-subscribed on every
  // selection change -- including the ones that fire continuously during a selection drag.
  const selectedRef = useRef(selectedNodeIds);
  selectedRef.current = selectedNodeIds;

  useEffect(() => {
    // Successive pastes of one clipboard cascade instead of stacking on the same spot.
    const paste = (fragment: GraphDocument, step: number) => {
      const { nodes, edges } = pasteFragment(
        fragment,
        { x: PASTE_OFFSET.x * step, y: PASTE_OFFSET.y * step },
        newNodeId,
      );
      if (nodes.length > 0) dispatch(actions.nodesPasted(nodes, edges));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (isNativeTextEditingTarget(event.target)) return;

      switch (event.key.toLowerCase()) {
        case 'c': {
          // Nothing selected means nothing to copy, and the browser's own copy should still
          // work -- so this falls through without preventing the default.
          if (selectedRef.current.length === 0) return;
          clipboardRef.current = copyNodes(getGraph(), selectedRef.current);
          pasteCountRef.current = 0;
          break;
        }
        case 'v': {
          if (!clipboardRef.current) return;
          pasteCountRef.current += 1;
          paste(clipboardRef.current, pasteCountRef.current);
          break;
        }
        case 'd': {
          if (selectedRef.current.length === 0) return;
          // Duplicate copies and pastes without touching the clipboard: duplicating one node
          // should not throw away what the user copied a minute ago.
          paste(copyNodes(getGraph(), selectedRef.current), 1);
          break;
        }
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dispatch, getGraph]);
}
