import { describe, expect, test } from 'bun:test';

import {
  canTransitionTaskState,
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
