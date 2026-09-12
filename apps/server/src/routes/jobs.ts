import { CreateJobRequestSchema, NodeParamsSchemaByType } from '@cutgraph/shared';
import { Hono } from 'hono';
import type { JobRunner } from '../jobs/jobRunner';
import type { SpendGuard } from '../jobs/spendGuard';

export function createJobsRoute(runner: JobRunner, spendGuard: SpendGuard): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsedRequest = CreateJobRequestSchema.safeParse(body);
    if (!parsedRequest.success) {
      return c.json({ error: { message: 'invalid request', issues: parsedRequest.error.issues } }, 400);
    }

    const { nodeType, params, inputs, cacheKey } = parsedRequest.data;
    const parsedParams = NodeParamsSchemaByType[nodeType].safeParse(params);
    if (!parsedParams.success) {
      return c.json({ error: { message: 'invalid params', issues: parsedParams.error.issues } }, 400);
    }

    // Checked here, before a job is ever queued, rather than inside JobRunner -- a rejection
    // must never become a queued job that immediately fails.
    const reservation = spendGuard.tryReserve();
    if (!reservation.ok) {
      return c.json({ error: { message: reservation.reason, code: 'SPEND_LIMIT' } }, 429);
    }

    // Releasing on the adapter settling (rather than on a terminal SSE event) is what makes the
    // slot recoverable: JobRunner's timeout guarantees the adapter settles, and a cancel frees
    // the slot without waiting for it.
    const { jobId, createdAt } = runner.create(nodeType, parsedParams.data, inputs, cacheKey, () =>
      spendGuard.release(),
    );

    return c.json({ jobId, status: 'queued', cacheKey, createdAt }, 202);
  });

  app.delete('/:id', async (c) => {
    const canceled = await runner.cancel(c.req.param('id'));
    // Already finished (or never existed) is not an error: the caller wanted it stopped, and it
    // is stopped. Reported honestly so the client can tell a real cancel from a no-op.
    return c.json({ canceled });
  });

  app.get('/:id', (c) => {
    const record = runner.get(c.req.param('id'));
    if (!record) return c.json({ error: { message: 'job not found' } }, 404);
    return c.json({
      jobId: record.jobId,
      status: record.status,
      cacheKey: record.cacheKey,
      result: record.result,
      error: record.error,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  });

  return app;
}
