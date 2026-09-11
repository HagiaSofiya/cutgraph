import { Hono } from 'hono';
import type { JobStore } from '../jobs/jobStore';
import { streamJobEvents } from '../sse/sseHub';

function parseLastEventId(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function createEventsRoute(store: JobStore): Hono {
  const app = new Hono();

  app.get('/:id/events', (c) => {
    const jobId = c.req.param('id');
    if (!store.get(jobId)) {
      return c.json({ error: { message: 'job not found' } }, 404);
    }

    // The browser's own auto-reconnect sets the Last-Event-ID header; a fresh page load can't,
    // so it passes ?lastEventId= explicitly instead. Header takes precedence when both appear.
    const lastEventId = parseLastEventId(c.req.header('Last-Event-ID') ?? c.req.query('lastEventId'));
    return streamJobEvents(c, store, jobId, lastEventId);
  });

  return app;
}
