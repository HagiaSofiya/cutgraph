import type { FailureCode } from '@cutgraph/shared';

interface Guidance {
  // Whether pressing Retry on the unchanged node has any chance of a different outcome. This is
  // the whole point of the taxonomy: a moderation rejection and a rate limit both used to render
  // as red text above an identical Retry button.
  retryable: boolean;
  hint: string;
}

export const FAILURE_GUIDANCE: Record<FailureCode, Guidance> = {
  MODERATION: {
    retryable: false,
    hint: 'Change the prompt or input image -- retrying it unchanged will be rejected again.',
  },
  RATE_LIMIT: { retryable: true, hint: 'Rate limited. Retrying in a moment should work.' },
  TIMEOUT: { retryable: true, hint: 'Timed out. Retrying may work.' },
  AUTH: {
    retryable: false,
    hint: "The server's API key or billing is not set up. Retrying will not help until it is reconfigured.",
  },
  TASK_FAILED: { retryable: true, hint: 'The generation task failed. Retrying may work.' },
  INPUT_TOO_LARGE: {
    retryable: false,
    hint: 'The input image is too large for this adapter. Use a smaller image.',
  },
  SPEND_LIMIT: {
    retryable: false,
    hint: 'The server hit its generation limit. Retrying will not help until it resets.',
  },
  CANCELED: { retryable: true, hint: 'Canceled before it finished.' },
  SIMULATED_FAILURE: {
    retryable: true,
    hint: 'Simulated failure from the fixture adapter -- no real generation was attempted.',
  },
};
