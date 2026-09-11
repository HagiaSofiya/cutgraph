import type { SseEvent } from '@cutgraph/shared';
import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { JobStore } from '../jobs/jobStore';

const HEARTBEAT_INTERVAL_MS = 15_000;

function isTerminal(event: SseEvent): boolean {
  return event.event === 'job.succeeded' || event.event === 'job.failed';
}

// A fresh page load can't set the Last-Event-ID header (EventSource only sends it on the
// browser's own automatic reconnect), so the route accepts `lastEventId` as a query param too
// -- both paths land here and get identical replay-then-live treatment.
export function streamJobEvents(c: Context, store: JobStore, jobId: string, lastEventId?: number) {
  return streamSSE(c, async (stream) => {
    const writeEvent = (event: SseEvent) =>
      stream.writeSSE({ event: event.event, id: String(event.id), data: JSON.stringify(event.data) });

    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });

    const replay = store.eventsSince(jobId, lastEventId);
    for (const event of replay) {
      await writeEvent(event);
    }

    if (replay.some(isTerminal)) {
      return; // job was already done -- nothing further will ever be emitted for it
    }

    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const unsubscribe = store.subscribe(jobId, (event) => {
      if (closed) return;
      void writeEvent(event).then(() => {
        if (isTerminal(event)) resolveDone();
      });
    });
    stream.onAbort(() => {
      unsubscribe();
      resolveDone();
    });

    const heartbeat = setInterval(() => {
      if (!closed) void stream.write(': heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS);

    await done;
    clearInterval(heartbeat);
    unsubscribe();
  });
}
