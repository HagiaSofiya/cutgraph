import { useOnSelectionChange } from '@xyflow/react';
import { useCallback, useState } from 'react';

// xyflow owns selection -- the reducer has no notion of it, and node components only ever read
// their own `selected` prop to decide whether to mount a real <video>. This is the one place it
// is lifted out, so the toolbar can scope a run to what the user actually picked.
export function useSelectedNodeIds(): string[] {
  const [selected, setSelected] = useState<string[]>([]);

  // Memoized because useOnSelectionChange re-subscribes whenever the handler's identity changes.
  const onChange = useCallback(({ nodes }: { nodes: Array<{ id: string }> }) => {
    setSelected((current) => {
      const next = nodes.map((node) => node.id).sort();
      // Selection changes fire while dragging too. Holding the same array identity when the set
      // is unchanged keeps this from invalidating the run plan's memo on every tick.
      const same = current.length === next.length && current.every((id, i) => id === next[i]);
      return same ? current : next;
    });
  }, []);

  useOnSelectionChange({ onChange });
  return selected;
}
