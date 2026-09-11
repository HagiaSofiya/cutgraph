import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { JobStore } from '../src/jobs/jobStore';
import { createEventsRoute } from '../src/routes/events';

function buildApp(store: JobStore): Hono {
  const app = new Hono();
  app.route('/api/jobs', createEventsRoute(store));
  return app;
}

interface ParsedFrame {
  event?: string;
  id?: string;
  data?: string;
}

function parseSseFrames(text: string): ParsedFrame[] {
  return text
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map((frame) => {
      const out: ParsedFrame = {};
      for (const line of frame.split('\n')) {
        if (line.startsWith('event: ')) out.event = line.slice('event: '.length);
        else if (line.startsWith('id: ')) out.id = line.slice('id: '.length);
        else if (line.startsWith('data: ')) out.data = line.slice('data: '.length);
      }
      return out;
    });
}

const succeeded = { url: 'http://x/img.png', kind: 'image' as const, width: 1, height: 1 };

describe('GET /api/jobs/:id/events', () => {
  it('returns 404 for an unknown job (no stream opened)', async () => {
    const app = buildApp(new JobStore(60_000));
    const res = await app.request('/api/jobs/unknown/events');
    expect(res.status).toBe(404);
  });

  it('replays full history for an already-terminal job and then closes the stream', async () => {
    const store = new JobStore(60_000);
    store.create('job-1', 'textToImage', 'key-1');
    store.markRunning('job-1');
    store.markSucceeded('job-1', succeeded);

    const res = await buildApp(store).request('/api/jobs/job-1/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const frames = parseSseFrames(await res.text());
    expect(frames.map((f) => f.event)).toEqual(['job.queued', 'job.running', 'job.succeeded']);
    expect(frames.map((f) => f.id)).toEqual(['0', '1', '2']);
  });

  it('honors the Last-Event-ID header (browser auto-reconnect) and skips already-seen events', async () => {
    const store = new JobStore(60_000);
    store.create('job-1', 'textToImage', 'key-1');
    store.markRunning('job-1');
    store.markSucceeded('job-1', succeeded);

    const res = await buildApp(store).request('/api/jobs/job-1/events', {
      headers: { 'Last-Event-ID': '1' },
    });
    const frames = parseSseFrames(await res.text());
    expect(frames.map((f) => f.event)).toEqual(['job.succeeded']);
  });

  it('honors ?lastEventId= for a fresh page load, where no Last-Event-ID header is available', async () => {
    const store = new JobStore(60_000);
    store.create('job-1', 'textToImage', 'key-1');
    store.markRunning('job-1');
    store.markSucceeded('job-1', succeeded);

    const res = await buildApp(store).request('/api/jobs/job-1/events?lastEventId=0');
    const frames = parseSseFrames(await res.text());
    expect(frames.map((f) => f.event)).toEqual(['job.running', 'job.succeeded']);
  });

  it('streams live events to multiple concurrent subscribers, each seeing every event exactly once', async () => {
    const store = new JobStore(60_000);
    store.create('job-1', 'textToImage', 'key-1');
    const app = buildApp(store);

    const res1 = await app.request('/api/jobs/job-1/events');
    const res2 = await app.request('/api/jobs/job-1/events');
    const read1 = res1.text();
    const read2 = res2.text();

    // Let both connections finish replaying the buffered 'queued' event and park on `done`
    // before driving the job forward, so the live events below aren't racing subscription setup.
    await new Promise((resolve) => setTimeout(resolve, 20));

    store.markRunning('job-1');
    store.markSucceeded('job-1', succeeded);

    const [frames1, frames2] = (await Promise.all([read1, read2])).map(parseSseFrames);
    expect(frames1.map((f) => f.event)).toEqual(['job.queued', 'job.running', 'job.succeeded']);
    expect(frames2.map((f) => f.event)).toEqual(['job.queued', 'job.running', 'job.succeeded']);
  });
});
