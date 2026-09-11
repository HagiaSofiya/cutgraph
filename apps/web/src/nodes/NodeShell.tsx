import type { NodeStatus } from '@cutgraph/shared';
import { Handle, Position } from '@xyflow/react';
import type { ReactNode } from 'react';
import { executorsByNodeType } from '../orchestrator/executors';
import { retryNode } from '../orchestrator/runGraph';
import { useGraph } from '../state/graphContext';

const STATUS_COLORS: Record<NodeStatus, string> = {
  idle: '#6b7280',
  queued: '#a855f7',
  running: '#3b82f6',
  succeeded: '#22c55e',
  failed: '#ef4444',
  stale: '#eab308',
};

interface TargetHandleSpec {
  id: string | null;
  label?: string;
}

interface NodeShellProps {
  id: string;
  title: string;
  status: NodeStatus;
  errorMessage?: string;
  targetHandles?: TargetHandleSpec[];
  hasSourceHandle?: boolean;
  children?: ReactNode;
}

export function NodeShell({
  id,
  title,
  status,
  errorMessage,
  targetHandles = [],
  hasSourceHandle = true,
  children,
}: NodeShellProps) {
  const { dispatch, getGraph } = useGraph();

  const handleRetry = () => {
    void retryNode(id, { getGraph, dispatch, executors: executorsByNodeType });
  };

  return (
    <div
      style={{
        border: `2px solid ${STATUS_COLORS[status]}`,
        borderRadius: 8,
        background: 'var(--node-bg, #1a1a1a)',
        color: 'var(--node-fg, #f5f5f5)',
        minWidth: 220,
        fontSize: 12,
      }}
    >
      {targetHandles.map((handle, index) => (
        <Handle
          key={handle.id ?? 'in'}
          type="target"
          position={Position.Left}
          id={handle.id ?? undefined}
          style={{ top: `${((index + 1) / (targetHandles.length + 1)) * 100}%` }}
        />
      ))}
      {hasSourceHandle && <Handle type="source" position={Position.Right} />}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '6px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          fontWeight: 600,
        }}
      >
        <span>{title}</span>
        <span
          title={status}
          style={{
            display: 'inline-block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: STATUS_COLORS[status],
          }}
        />
      </div>

      <div style={{ padding: 10 }}>{children}</div>

      {status === 'failed' && (
        <div style={{ padding: '0 10px 10px' }}>
          {errorMessage && <div style={{ color: '#ef4444', marginBottom: 6 }}>{errorMessage}</div>}
          <button onClick={handleRetry} type="button">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
