import { evaluateRetryPolicy } from '../../../../../../src/core/grizzco/engine/transaction/retry-policy.js';

describe('retry-policy', () => {
  it('does not retry when failure is non-retryable', () => {
    const decision = evaluateRetryPolicy({
      retries: 1,
      failure: {
        reason: 'fatal',
        reasonCode: 'LOOP_FAILED',
        diagnosticCode: 'LOOP_FAILED',
        safeHint: 'fatal',
        remediationSteps: [],
        failurePhase: 'APPLY',
        retryable: false,
      },
      maxRetries: 2,
    });

    expect(decision).toEqual({
      retries: 1,
      shouldRetry: false,
      retryExhausted: false,
    });
  });

  it('retries when failure is retryable and under limit', () => {
    const decision = evaluateRetryPolicy({
      retries: 1,
      failure: {
        reason: 'verify failed',
        reasonCode: 'VERIFY_FAILED',
        diagnosticCode: 'VERIFY_FAILED',
        safeHint: 'verify failed',
        remediationSteps: [],
        failurePhase: 'VERIFY',
        retryable: true,
      },
      maxRetries: 2,
    });

    expect(decision).toEqual({
      retries: 2,
      shouldRetry: true,
      retryExhausted: false,
    });
  });

  it('stops when retry budget is exhausted', () => {
    const decision = evaluateRetryPolicy({
      retries: 2,
      failure: {
        reason: 'verify failed',
        reasonCode: 'VERIFY_FAILED',
        diagnosticCode: 'VERIFY_FAILED',
        safeHint: 'verify failed',
        remediationSteps: [],
        failurePhase: 'VERIFY',
        retryable: true,
      },
      maxRetries: 2,
    });

    expect(decision).toEqual({
      retries: 3,
      shouldRetry: false,
      retryExhausted: true,
    });
  });
});
