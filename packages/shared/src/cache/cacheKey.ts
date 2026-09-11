import { sha256 } from '@noble/hashes/sha2.js';
import type { NodeType } from '../types';
import { stableStringify } from './hash';

const CACHE_KEY_VERSION = 1;

export interface CacheKeyUpstreamEntry {
  handle: string | null;
  sourceNodeId: string;
  outputId: string;
}

export interface CacheKeyInput {
  nodeType: NodeType;
  params: Record<string, unknown>;
  upstream: CacheKeyUpstreamEntry[];
}

// Sort by handle ascending, null last, tiebreak on sourceNodeId. Canonicalizing here (rather
// than trusting caller order) matters because building this array by iterating a Graph's
// `edges` record would yield insertion order, which does not survive a localStorage round
// trip -- every cache key would silently change on reload otherwise.
function compareUpstream(a: CacheKeyUpstreamEntry, b: CacheKeyUpstreamEntry): number {
  if (a.handle !== b.handle) {
    if (a.handle === null) return 1;
    if (b.handle === null) return -1;
    return a.handle < b.handle ? -1 : 1;
  }
  if (a.sourceNodeId === b.sourceNodeId) return 0;
  return a.sourceNodeId < b.sourceNodeId ? -1 : 1;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Synchronous (called from inside the reducer/orchestrator), so no crypto.subtle. SHA-256
// truncated to 128 bits via @noble/hashes -- MediaRef.id === cacheKey, so a collision here
// would serve the wrong media, not just waste a demo run.
export function deriveCacheKey(input: CacheKeyInput): string {
  const upstream = [...input.upstream].sort(compareUpstream);
  const canonical = stableStringify({
    v: CACHE_KEY_VERSION,
    t: input.nodeType,
    p: input.params,
    u: upstream.map((entry) => ({ h: entry.handle, o: entry.outputId })),
  });
  const digest = sha256(new TextEncoder().encode(canonical)).slice(0, 16);
  return `v${CACHE_KEY_VERSION}_${bytesToHex(digest)}`;
}
