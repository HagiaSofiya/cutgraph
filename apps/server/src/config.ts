import { fileURLToPath } from 'node:url';

export interface SimConfig {
  minLatencyMs: number;
  maxLatencyMs: number;
  minProcessingMs: number;
  maxProcessingMs: number;
  failureRate: number;
}

export type AdapterKind = 'fixture' | 'runway';

export interface SpendGuardConfig {
  maxGenerationsTotal: number;
  maxConcurrentJobs: number;
}

export interface AppConfig {
  sim: SimConfig;
  jobRetentionMs: number;
  port: number;
  publicOrigin: string;
  fixturesDir: string;
  uploadsDir: string;
  // Optional so existing test configs that construct AppConfig directly (predating the Runway
  // adapter) keep compiling unchanged. Absent means "fixture adapter, no spend limits" -- see
  // the fallbacks in index.ts.
  adapter?: AdapterKind;
  runwayApiKey?: string;
  spendGuard?: SpendGuardConfig;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envAdapterKind(name: string, fallback: AdapterKind): AdapterKind {
  const raw = process.env[name];
  return raw === 'runway' || raw === 'fixture' ? raw : fallback;
}

// Re-reads env each call rather than caching a module-level singleton, so tests can construct
// isolated configs (e.g. forcing failureRate to 0 or 1) without mutating global process.env.
export function loadConfig(): AppConfig {
  const port = envNumber('PORT', 8787);
  return {
    sim: {
      minLatencyMs: envNumber('CUTGRAPH_SIM_MIN_LATENCY_MS', 400),
      maxLatencyMs: envNumber('CUTGRAPH_SIM_MAX_LATENCY_MS', 1200),
      minProcessingMs: envNumber('CUTGRAPH_SIM_MIN_PROCESSING_MS', 1500),
      maxProcessingMs: envNumber('CUTGRAPH_SIM_MAX_PROCESSING_MS', 4000),
      failureRate: envNumber('CUTGRAPH_SIM_FAILURE_RATE', 0.15),
    },
    jobRetentionMs: envNumber('CUTGRAPH_JOB_RETENTION_MS', 600_000),
    port,
    publicOrigin: process.env.CUTGRAPH_PUBLIC_ORIGIN || `http://localhost:${port}`,
    fixturesDir: fileURLToPath(new URL('../fixtures', import.meta.url)),
    uploadsDir: fileURLToPath(new URL('../uploads', import.meta.url)),
    adapter: envAdapterKind('CUTGRAPH_ADAPTER', 'fixture'),
    runwayApiKey: process.env.CUTGRAPH_RUNWAY_API_KEY || undefined,
    spendGuard: {
      maxGenerationsTotal: envNumber('CUTGRAPH_MAX_GENERATIONS_TOTAL', 50),
      maxConcurrentJobs: envNumber('CUTGRAPH_MAX_CONCURRENT_JOBS', 3),
    },
  };
}
