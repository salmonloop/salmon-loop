import { describe, expect, test } from 'bun:test';

import {
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
});
