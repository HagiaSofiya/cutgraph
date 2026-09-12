import type { HealthResponse } from '@cutgraph/shared';
import { useEffect, useState } from 'react';
import { getHealth } from '../api/client';

type Health = HealthResponse | 'unreachable' | undefined;

interface Appearance {
  color: string;
  label: string;
  title: string;
}

function describe(health: HealthResponse): Appearance {
  const { requested, active } = health.adapter;

  if (active === 'fixture' && requested === 'runway') {
    // The trap this badge exists for: the server was asked for a real adapter, could not build
    // one, and fell back -- previously visible only as a console.warn in the server's terminal.
    return {
      color: '#ef4444',
      label: 'Fixture fallback',
      title:
        'CUTGRAPH_ADAPTER=runway was requested but no usable CUTGRAPH_RUNWAY_API_KEY was found, ' +
        'so the server fell back to fixtures. Results are pre-rendered files, not generations.',
    };
  }

  if (active === 'fixture') {
    return {
      color: '#eab308',
      label: 'Fixture mode',
      title:
        'No model is involved: each generation node sleeps, then returns one of a few ' +
        'pre-rendered ffmpeg files chosen by hashing its params. Set CUTGRAPH_ADAPTER=runway ' +
        'with an API key on the server for real generations.',
    };
  }

  const models = [...health.models.textToImage, ...health.models.imageToVideo];
  const { generationsUsed, maxGenerationsTotal } = health.limits;
  const cap = maxGenerationsTotal ?? '\u221e';
  return {
    color: '#22c55e',
    label: `Runway · ${generationsUsed}/${cap}`,
    title: `Real generations via ${models.join(', ')}. ${generationsUsed} of ${cap} used this server process.`,
  };
}

// Fetched once on mount. The adapter cannot change without restarting the server, so there is
// nothing to poll for -- the spend counter goes stale, which is why the badge shows it as a
// starting point rather than a live meter.
export function AdapterBadge() {
  const [health, setHealth] = useState<Health>(undefined);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((h) => !cancelled && setHealth(h))
      .catch(() => !cancelled && setHealth('unreachable'));
    return () => {
      cancelled = true;
    };
  }, []);

  if (health === undefined) return null;

  const { color, label, title } =
    health === 'unreachable'
      ? { color: '#ef4444', label: 'Server unreachable', title: 'Could not reach the cutgraph server.' }
      : describe(health);

  return (
    <span
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        marginRight: 8,
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 11,
        whiteSpace: 'nowrap',
        cursor: 'help',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      {label}
    </span>
  );
}
