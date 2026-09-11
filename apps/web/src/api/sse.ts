import { SseEventSchema } from '@cutgraph/shared';
import type { SseEvent } from '@cutgraph/shared';
import { API_BASE } from './client';

export interface SubscribeOptions {
  // Set only when opening a *new* EventSource after a page reload -- the browser's own
  // reconnect after a dropped connection sends Last-Event-ID as a header automatically and
  // needs nothing from us here.
  lastEventId?: number;
  onEvent: (event: SseEvent) => void;
  onError?: (error: unknown) => void;
}

const EVENT_NAMES: SseEvent['event'][] = ['job.queued', 'job.running', 'job.succeeded', 'job.failed'];

export function subscribeToJob(jobId: string, options: SubscribeOptions): () => void {
  const url = new URL(`${API_BASE}/api/jobs/${jobId}/events`);
  if (options.lastEventId !== undefined) {
    url.searchParams.set('lastEventId', String(options.lastEventId));
  }

  const source = new EventSource(url.toString());

  for (const eventName of EVENT_NAMES) {
    source.addEventListener(eventName, (raw) => {
      const messageEvent = raw as MessageEvent<string>;
      try {
        const event = SseEventSchema.parse({
          id: Number(messageEvent.lastEventId),
          event: eventName,
          data: JSON.parse(messageEvent.data),
        });
        options.onEvent(event);
      } catch (err) {
        options.onError?.(err);
      }
    });
  }

  source.onerror = (err) => {
    options.onError?.(err);
  };

  return () => source.close();
}
