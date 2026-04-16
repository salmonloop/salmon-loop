import { describe, expect, test } from 'bun:test';
import { createTaskTransitionPolicy } from '../../../../src/core/interaction/model/transition-policy.js';

describe('createTaskTransitionPolicy', () => {
  test('allows method enforces the canonical task transition matrix', () => {
    const policy = createTaskTransitionPolicy();
    expect(policy.allows('accepted', 'running')).toBe(true);
    expect(policy.allows('running', 'streaming')).toBe(true);
    expect(policy.allows('streaming', 'awaiting_input')).toBe(true);
    expect(policy.allows('awaiting_input', 'running')).toBe(true);
    expect(policy.allows('failed', 'accepted')).toBe(true);
    expect(policy.allows('completed', 'awaiting_input')).toBe(true);

    expect(policy.allows('completed', 'running')).toBe(false);
    expect(policy.allows('cancelled', 'streaming')).toBe(false);
    expect(policy.allows('accepted', 'completed')).toBe(false);
  });

  test('allowedTargets returns possible transitions from a state', () => {
    const policy = createTaskTransitionPolicy();
    expect(policy.allowedTargets('running')).toEqual([
      'streaming',
      'awaiting_input',
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(policy.allowedTargets('accepted')).toEqual(['running', 'cancelled']);
  });

  test('isResumable identifies resumable states', () => {
    const policy = createTaskTransitionPolicy();
    expect(policy.isResumable('streaming')).toBe(true);
    expect(policy.isResumable('awaiting_input')).toBe(true);
    expect(policy.isResumable('completed')).toBe(false);
    expect(policy.isResumable('running')).toBe(false);
  });

  test('isRetryable identifies retryable states', () => {
    const policy = createTaskTransitionPolicy();
    expect(policy.isRetryable('failed')).toBe(true);
    expect(policy.isRetryable('cancelled')).toBe(true);
    expect(policy.isRetryable('completed')).toBe(false);
    expect(policy.isRetryable('running')).toBe(false);
  });

  test('isReopenable identifies reopenable states', () => {
    const policy = createTaskTransitionPolicy();
    expect(policy.isReopenable('completed')).toBe(true);
    expect(policy.isReopenable('failed')).toBe(true);
    expect(policy.isReopenable('cancelled')).toBe(true);
    expect(policy.isReopenable('running')).toBe(false);
  });

  test('canRetry evaluates retry eligibility', () => {
    const policy = createTaskTransitionPolicy();

    // Not retryable state
    expect(
      policy.canRetry({
        state: 'completed',
        failure: { code: 'VERIFY_FAILED', category: 'verification', retryable: true, message: '' },
      }),
    ).toBe(false);

    // No failure
    expect(
      policy.canRetry({
        state: 'failed',
      }),
    ).toBe(false);

    // Failure not retryable
    expect(
      policy.canRetry({
        state: 'failed',
        failure: { code: 'VERIFY_FAILED', category: 'verification', retryable: false, message: '' },
      }),
    ).toBe(false);

    // Failure has no category
    expect(
      policy.canRetry({
        state: 'failed',
        failure: { code: 'VERIFY_FAILED', retryable: true, message: '' },
      }),
    ).toBe(false);

    // Invalid category
    expect(
      policy.canRetry({
        state: 'failed',
        failure: { code: 'POLICY_BLOCK', category: 'policy', retryable: true, message: '' },
      }),
    ).toBe(false);

    // Valid category
    expect(
      policy.canRetry({
        state: 'failed',
        failure: { code: 'VERIFY_FAILED', category: 'verification', retryable: true, message: '' },
      }),
    ).toBe(true);
    expect(
      policy.canRetry({
        state: 'failed',
        failure: { code: 'ERR', category: 'runtime', retryable: true, message: '' },
      }),
    ).toBe(true);
    expect(
      policy.canRetry({
        state: 'failed',
        failure: { code: 'ERR', category: 'infrastructure', retryable: true, message: '' },
      }),
    ).toBe(true);
  });

  test('canReopen evaluates reopen eligibility', () => {
    const policy = createTaskTransitionPolicy();

    // Not reopenable state
    expect(
      policy.canReopen({
        state: 'running',
      }),
    ).toBe(false);

    // Always reopenable if completed
    expect(
      policy.canReopen({
        state: 'completed',
      }),
    ).toBe(true);
    expect(
      policy.canReopen({
        state: 'completed',
        failure: { code: 'ERR', category: 'policy', retryable: false, message: '' }
      }),
    ).toBe(true);

    // Reopenable if failed with valid category
    expect(
      policy.canReopen({
        state: 'failed',
        failure: { code: 'VERIFY_FAILED', category: 'verification', retryable: true, message: '' },
      }),
    ).toBe(true);

    // Not reopenable if failed with invalid category
    expect(
      policy.canReopen({
        state: 'failed',
        failure: { code: 'POLICY_BLOCK', category: 'policy', retryable: true, message: '' },
      }),
    ).toBe(false);

    // Not reopenable if failed without category
    expect(
      policy.canReopen({
        state: 'failed',
        failure: { code: 'ERR', retryable: true, message: '' },
      }),
    ).toBe(false);

    // Not reopenable if failed without failure object
    expect(
      policy.canReopen({
        state: 'failed',
      }),
    ).toBe(false);
  });
});
