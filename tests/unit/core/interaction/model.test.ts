import { describe, expect, test } from 'bun:test';

import {
  canTransitionTaskState,
  createTaskTransitionPolicy,
  isTerminalTaskState,
  type TaskEnvelope,
} from '../../../../src/core/interaction/model/index.js';

describe('interaction model', () => {
  test('recognizes terminal task states', () => {
    expect(isTerminalTaskState('completed')).toBe(true);
    expect(isTerminalTaskState('failed')).toBe(true);
    expect(isTerminalTaskState('running')).toBe(false);
  });

  test('allows tenant-aware task envelopes', () => {
    const task: TaskEnvelope = {
      id: 'task_123',
      capability: 'patch',
      state: 'accepted',
      tenantId: 'default',
      request: { instruction: 'fix bug' },
      createdAt: '2026-02-28T00:00:00.000Z',
    };

    expect(task.tenantId).toBe('default');
    expect(task.capability).toBe('patch');
  });

  test('exposes transition policy predicates and allowed targets', () => {
    const policy = createTaskTransitionPolicy();

    expect(policy.allowedTargets('running')).toEqual([
      'streaming',
      'awaiting_input',
      'completed',
      'failed',
      'cancelled',
    ]);
    expect(policy.isResumable('streaming')).toBe(true);
    expect(policy.isResumable('completed')).toBe(false);
    expect(policy.isRetryable('failed')).toBe(true);
    expect(policy.isRetryable('completed')).toBe(false);
    expect(policy.isReopenable('completed')).toBe(true);
    expect(policy.isReopenable('running')).toBe(false);
  });

  test('evaluates retry and reopen eligibility using failure metadata', () => {
    const policy = createTaskTransitionPolicy();

    expect(
      policy.canRetry({
        state: 'failed',
        failure: { code: 'VERIFY_FAILED', category: 'verification', retryable: true, message: '' },
      }),
    ).toBe(true);
    expect(
      policy.canRetry({
        state: 'failed',
        failure: { code: 'POLICY_BLOCK', category: 'policy', retryable: true, message: '' },
      }),
    ).toBe(false);
    expect(
      policy.canRetry({
        state: 'failed',
        failure: { code: 'VERIFY_FAILED', category: 'verification', retryable: false, message: '' },
      }),
    ).toBe(false);

    expect(
      policy.canReopen({
        state: 'completed',
      }),
    ).toBe(true);
    expect(
      policy.canReopen({
        state: 'failed',
        failure: { code: 'VERIFY_FAILED', category: 'verification', retryable: true, message: '' },
      }),
    ).toBe(true);
    expect(
      policy.canReopen({
        state: 'failed',
        failure: { code: 'POLICY_BLOCK', category: 'policy', retryable: true, message: '' },
      }),
    ).toBe(false);
  });

  test('enforces the canonical task transition matrix', () => {
    expect(canTransitionTaskState('accepted', 'running')).toBe(true);
    expect(canTransitionTaskState('running', 'streaming')).toBe(true);
    expect(canTransitionTaskState('streaming', 'awaiting_input')).toBe(true);
    expect(canTransitionTaskState('awaiting_input', 'running')).toBe(true);
    expect(canTransitionTaskState('failed', 'accepted')).toBe(true);
    expect(canTransitionTaskState('completed', 'awaiting_input')).toBe(true);

    expect(canTransitionTaskState('completed', 'running')).toBe(false);
    expect(canTransitionTaskState('cancelled', 'streaming')).toBe(false);
    expect(canTransitionTaskState('accepted', 'completed')).toBe(false);
  });
});
