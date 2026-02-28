import { describe, expect, test } from 'bun:test';

import { createTaskSyncEngine } from '../../../../src/core/interaction/sync/task-sync-engine.js';

describe('Task sync engine', () => {
  test('applies snapshots and events', () => {
    const engine = createTaskSyncEngine();

    engine.applySnapshot({
      id: 'task_1',
      capability: 'patch',
      state: 'accepted',
      request: { instruction: 'fix bug' },
      createdAt: '2026-02-28T00:00:00.000Z',
    });

    const updated = engine.applyEvent({
      id: '1',
      type: 'task.failed',
      taskId: 'task_1',
      state: 'failed',
      attempt: 2,
      failure: { category: 'verification', code: 'VERIFY_FAILED' },
    });

    expect(updated).toMatchObject({
      id: 'task_1',
      state: 'failed',
      attempt: 2,
      failure: { category: 'verification', code: 'VERIFY_FAILED' },
    });
  });

  test('keeps existing request when events lack instruction', () => {
    const engine = createTaskSyncEngine();
    engine.applySnapshot({
      id: 'task_2',
      capability: 'patch',
      state: 'accepted',
      request: { instruction: 'seed' },
      createdAt: '2026-02-28T00:00:00.000Z',
    });

    const updated = engine.applyEvent({
      id: '2',
      type: 'task.completed',
      taskId: 'task_2',
      state: 'completed',
    });

    expect(updated.request.instruction).toBe('seed');
  });
});
