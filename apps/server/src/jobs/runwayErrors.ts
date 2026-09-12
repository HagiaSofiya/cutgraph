import {
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  TaskFailedError,
  TaskTimedOutError,
} from '@runwayml/sdk';
import type { NodeFailure } from '@cutgraph/shared';

// Maps whatever the Runway SDK throws to a user-facing message *and* a FailureCode. The code is
// what lets the canvas tell "retrying this unchanged might work" (RATE_LIMIT, TIMEOUT) apart from
// "it never will until you change something" (MODERATION, AUTH) -- previously both arrived as
// identical red text under an identical Retry button.
export function mapRunwayError(err: unknown): NodeFailure {
  if (err instanceof TaskFailedError) {
    const details = err.taskDetails;
    const failureText = 'failure' in details ? details.failure : 'the task was cancelled';
    const failureCode = 'failureCode' in details ? details.failureCode : undefined;

    if (failureCode?.startsWith('SAFETY.')) {
      return {
        message: `Rejected by content moderation: ${failureText}. Try adjusting the prompt or input image.`,
        code: 'MODERATION',
      };
    }
    return { message: `Generation failed: ${failureText}`, code: 'TASK_FAILED' };
  }

  if (err instanceof TaskTimedOutError) {
    return { message: 'Generation timed out waiting for Runway to finish the task.', code: 'TIMEOUT' };
  }

  if (err instanceof APIConnectionTimeoutError) {
    return { message: 'Timed out connecting to the Runway API.', code: 'TIMEOUT' };
  }

  if (err instanceof RateLimitError) {
    return { message: 'Rate limited by the Runway API. Please try again in a moment.', code: 'RATE_LIMIT' };
  }

  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return {
      message:
        'Runway API authentication or billing error. Check CUTGRAPH_RUNWAY_API_KEY and the account billing status.',
      code: 'AUTH',
    };
  }

  const message = err instanceof Error ? err.message : String(err);
  // The adapter's own pre-flight refusal (see resolvePromptImage) never reaches the SDK, so it
  // arrives here as a plain Error -- matched on the text it threw with.
  if (message.includes('data-URI limit')) return { message, code: 'INPUT_TOO_LARGE' };
  return { message };
}
