import type { AdapterKind, HealthResponse } from '@cutgraph/shared';
import { Hono } from 'hono';
import type { SpendGuard } from '../jobs/spendGuard';

export interface HealthInfo {
  requested: AdapterKind;
  active: AdapterKind;
  models: HealthResponse['models'];
}

// Reports which adapter is *actually* serving generations, not which one was configured. The
// difference is the whole point: `CUTGRAPH_ADAPTER=runway` with a missing key silently serves
// fixtures, and until this endpoint carried the distinction the only evidence was a server-side
// console.warn.
export function createHealthRoute(info: HealthInfo, spendGuard: SpendGuard): Hono {
  return new Hono().get('/', (c) => {
    const body: HealthResponse = {
      ok: true,
      adapter: { requested: info.requested, active: info.active },
      models: info.models,
      limits: spendGuard.snapshot(),
    };
    return c.json(body);
  });
}
