import {
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  TaskFailedError,
  TaskTimedOutError,
} from '@runwayml/sdk';
import { describe, expect, it } from 'vitest';
import { mapRunwayError } from '../src/jobs/runwayErrors';

describe('mapRunwayError', () => {
  it('gives a user-actionable message for a content moderation rejection', () => {
    const err = new TaskFailedError({
      id: 'task_1',
      cost: { credits: 0 },
      createdAt: '2026-01-01T00:00:00Z',
      status: 'FAILED',
      failure: 'input prompt violates content policy',
      failureCode: 'SAFETY.INPUT.TEXT',
    });

    const mapped = mapRunwayError(err);
    expect(mapped.message).toContain('content moderation');
    expect(mapped.message).toContain('input prompt violates content policy');
  });

  it('gives a distinct message for a non-moderation task failure', () => {
    const err = new TaskFailedError({
      id: 'task_1',
      cost: { credits: 0 },
      createdAt: '2026-01-01T00:00:00Z',
      status: 'FAILED',
      failure: 'internal generation error',
      failureCode: 'INTERNAL.BAD_OUTPUT.WATERMARK',
    });

    const mapped = mapRunwayError(err);
    expect(mapped.message).not.toContain('content moderation');
    expect(mapped.message).toContain('internal generation error');
  });

  it('handles a cancelled task, which has no failure/failureCode fields', () => {
    const err = new TaskFailedError({
      id: 'task_1',
      cost: { credits: 0 },
      createdAt: '2026-01-01T00:00:00Z',
      status: 'CANCELLED',
    });

    expect(() => mapRunwayError(err)).not.toThrow();
    expect(mapRunwayError(err).message).toContain('cancelled');
  });

  it('maps a client-side wait timeout distinctly from a network connection timeout', () => {
    const waitTimeout = new TaskTimedOutError({
      id: 'task_1',
      cost: { credits: 0 },
      createdAt: '2026-01-01T00:00:00Z',
      status: 'RUNNING',
      progress: 0.5,
    });
    const connectionTimeout = new APIConnectionTimeoutError();

    expect(mapRunwayError(waitTimeout).message).toContain('Runway to finish');
    expect(mapRunwayError(connectionTimeout).message).toContain('connecting to the Runway API');
  });

  it('maps a rate limit error as retryable-sounding, not a config problem', () => {
    const err = new RateLimitError(429, {}, 'rate limited', new Headers());
    expect(mapRunwayError(err).message).toContain('Rate limited');
  });

  it('maps auth and billing errors to a config-problem message, not retryable-sounding', () => {
    const authErr = new AuthenticationError(401, {}, 'invalid key', new Headers());
    const billingErr = new PermissionDeniedError(403, {}, 'plan not active', new Headers());

    expect(mapRunwayError(authErr).message).toContain('CUTGRAPH_RUNWAY_API_KEY');
    expect(mapRunwayError(billingErr).message).toContain('billing');
  });

  it('falls back to the error message for anything unrecognized, and never throws', () => {
    expect(mapRunwayError(new Error('something else broke')).message).toBe('something else broke');
    expect(mapRunwayError('a plain string').message).toBe('a plain string');
  });

  it('tags each failure kind with the code the canvas uses to decide whether Retry can help', () => {
    const moderation = new TaskFailedError({
      id: 'task_1',
      cost: { credits: 0 },
      createdAt: '2026-01-01T00:00:00Z',
      status: 'FAILED',
      failure: 'nope',
      failureCode: 'SAFETY.INPUT.TEXT',
    });
    const taskFailed = new TaskFailedError({
      id: 'task_2',
      cost: { credits: 0 },
      createdAt: '2026-01-01T00:00:00Z',
      status: 'FAILED',
      failure: 'internal error',
      failureCode: 'INTERNAL.BAD_OUTPUT',
    });

    expect(mapRunwayError(moderation).code).toBe('MODERATION');
    expect(mapRunwayError(taskFailed).code).toBe('TASK_FAILED');
    expect(mapRunwayError(new TaskTimedOutError()).code).toBe('TIMEOUT');
    expect(mapRunwayError(new APIConnectionTimeoutError()).code).toBe('TIMEOUT');
    expect(mapRunwayError(new RateLimitError(429, undefined, 'rate limited', undefined)).code).toBe('RATE_LIMIT');
    expect(mapRunwayError(new AuthenticationError(401, undefined, 'bad key', undefined)).code).toBe('AUTH');
    expect(mapRunwayError(new PermissionDeniedError(403, undefined, 'no billing', undefined)).code).toBe('AUTH');
  });

  it("codes the adapter's own oversized-input refusal, which never reaches the SDK", () => {
    const err = new Error('input image (4.2MB) exceeds the 3.5MB data-URI limit for this adapter');
    expect(mapRunwayError(err).code).toBe('INPUT_TOO_LARGE');
  });

  it('leaves an unrecognized error uncoded rather than guessing', () => {
    expect(mapRunwayError(new Error('something else entirely')).code).toBeUndefined();
  });
});
