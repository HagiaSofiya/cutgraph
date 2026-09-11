import { describe, expect, it } from 'vitest';
import { JobStore } from '../src/jobs/jobStore';

describe('JobStore', () => {
  it('creates a job in queued status with a queued event buffered', () => {
    const store = new JobStore(60_000);
    const record = store.create('job-1', 'textToImage', 'key-1');
    expect(record.status).toBe('queued');
    expect(store.eventsSince('job-1')).toHaveLength(1);
    expect(store.eventsSince('job-1')[0].event).toBe('job.queued');
  });

  it('walks queued -> running -> succeeded, buffering at most the last 3 events', () => {
    const store = new JobStore(60_000);
    store.create('job-1', 'textToImage', 'key-1');
    store.markRunning('job-1');
    store.markSucceeded('job-1', { url: 'http://x/img.png', kind: 'image', width: 1, height: 1 });

    const record = store.get('job-1');
    expect(record?.status).toBe('succeeded');
    const events = store.eventsSince('job-1');
    expect(events.map((e) => e.event)).toEqual(['job.queued', 'job.running', 'job.succeeded']);
  });

  it('ignores a terminal transition once the job is already terminal', () => {
    const store = new JobStore(60_000);
    store.create('job-1', 'textToImage', 'key-1');
    store.markRunning('job-1');
    store.markSucceeded('job-1', { url: 'http://x/img.png', kind: 'image', width: 1, height: 1 });
    store.markFailed('job-1', { message: 'too late' });

    expect(store.get('job-1')?.status).toBe('succeeded');
  });

  it('eventsSince returns only events newer than lastEventId', () => {
    const store = new JobStore(60_000);
    store.create('job-1', 'textToImage', 'key-1');
    store.markRunning('job-1');

    expect(store.eventsSince('job-1', 0).map((e) => e.event)).toEqual(['job.running']);
    expect(store.eventsSince('job-1', 1)).toEqual([]);
    expect(store.eventsSince('unknown-job', 0)).toEqual([]);
  });

  it('returns undefined for an unknown job id (the route layer turns this into 404)', () => {
    const store = new JobStore(60_000);
    expect(store.get('does-not-exist')).toBeUndefined();
  });

  it('notifies subscribers of new events as they happen', () => {
    const store = new JobStore(60_000);
    store.create('job-1', 'textToImage', 'key-1');

    const received: string[] = [];
    const unsubscribe = store.subscribe('job-1', (event) => received.push(event.event));

    store.markRunning('job-1');
    store.markSucceeded('job-1', { url: 'http://x/img.png', kind: 'image', width: 1, height: 1 });
    expect(received).toEqual(['job.running', 'job.succeeded']);

    unsubscribe();
    store.markFailed('job-1', { message: 'after unsubscribe' }); // no-op anyway (already terminal)
    expect(received).toEqual(['job.running', 'job.succeeded']);
  });

  it('sweepExpired evicts jobs past their retention window, but not before it', () => {
    let now = 0;
    const store = new JobStore(1000, () => now);
    store.create('job-1', 'textToImage', 'key-1');
    store.markRunning('job-1');
    store.markSucceeded('job-1', { url: 'http://x/img.png', kind: 'image', width: 1, height: 1 });

    now = 999;
    store.sweepExpired();
    expect(store.get('job-1')).toBeDefined();

    now = 1001;
    store.sweepExpired();
    expect(store.get('job-1')).toBeUndefined();
  });

  it('does not evict a still-in-flight job regardless of age', () => {
    let now = 0;
    const store = new JobStore(100, () => now);
    store.create('job-1', 'textToImage', 'key-1');

    now = 100_000;
    store.sweepExpired();
    expect(store.get('job-1')).toBeDefined();
  });
});
