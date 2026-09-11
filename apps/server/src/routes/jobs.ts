import { CreateJobRequestSchema, NodeParamsSchemaByType } from '@cutgraph/shared';
import { Hono } from 'hono';
import type { JobRunner } from '../jobs/jobRunner';

export function createJobsRoute(runner: JobRunner): Hono {
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

    const { jobId, createdAt } = runner.create(nodeType, parsedParams.data, inputs, cacheKey);
    return c.json({ jobId, status: 'queued', cacheKey, createdAt }, 202);
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
