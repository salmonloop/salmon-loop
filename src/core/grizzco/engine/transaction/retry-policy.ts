import { LIMITS } from '../../../config/limits.js';

import type { AttemptFailureDetails } from './attempt-failure.js';

export interface RetryPolicyDecision {
  retries: number;
  shouldRetry: boolean;
  retryExhausted: boolean;
}

export function evaluateRetryPolicy(params: {
  retries: number;
  failure: AttemptFailureDetails;
  maxRetries?: number;
}): RetryPolicyDecision {
  const { retries, failure, maxRetries = LIMITS.maxRetries } = params;

  if (!failure.retryable) {
    return {
      retries,
      shouldRetry: false,
      retryExhausted: false,
    };
  }

  const nextRetries = retries + 1;
  const retryExhausted = nextRetries > maxRetries;

  return {
    retries: nextRetries,
    shouldRetry: !retryExhausted,
    retryExhausted,
  };
}
