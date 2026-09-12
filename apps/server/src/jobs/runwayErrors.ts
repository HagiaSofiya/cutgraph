import {
  APIConnectionTimeoutError,
  AuthenticationError,
  PermissionDeniedError,
  RateLimitError,
  TaskFailedError,
  TaskTimedOutError,
} from '@runwayml/sdk';

// Maps whatever the Runway SDK throws to a single user-facing message. Deliberately just
// {message}, matching the wire shape NODE_FAILED/SseEvent actually carry today -- see the
// adapter-facing GenerateResult.error.code field, which exists but nothing downstream (JobStore,
// the SSE schema, the NODE_FAILED action) threads through yet. Distinguishing failure kinds by
// message text keeps this phase entirely inside apps/server/.
export function mapRunwayError(err: unknown): { message: string } {
  if (err instanceof TaskFailedError) {
    const details = err.taskDetails;
    const failureText = 'failure' in details ? details.failure : 'the task was cancelled';
    const failureCode = 'failureCode' in details ? details.failureCode : undefined;

    if (failureCode?.startsWith('SAFETY.')) {
      return {
        message: `Rejected by content moderation: ${failureText}. Try adjusting the prompt or input image.`,
      };
    }
    return { message: `Generation failed: ${failureText}` };
  }

  if (err instanceof TaskTimedOutError) {
    return { message: 'Generation timed out waiting for Runway to finish the task.' };
  }

  if (err instanceof APIConnectionTimeoutError) {
    return { message: 'Timed out connecting to the Runway API.' };
  }

  if (err instanceof RateLimitError) {
    return { message: 'Rate limited by the Runway API. Please try again in a moment.' };
  }

  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError) {
    return {
      message:
        'Runway API authentication or billing error. Check CUTGRAPH_RUNWAY_API_KEY and the account billing status.',
    };
  }

  return { message: err instanceof Error ? err.message : String(err) };
}
