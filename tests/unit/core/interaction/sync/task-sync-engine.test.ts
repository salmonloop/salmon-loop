import { describe, it, expect, beforeEach } from 'bun:test';

import type { TaskEvent } from '../../../../../src/core/interaction/events/bus.js';
import type { TaskEnvelope } from '../../../../../src/core/interaction/model/index.js';
import { createTaskSyncEngine } from '../../../../../src/core/interaction/sync/task-sync-engine.js';

describe('createTaskSyncEngine', () => {
  let syncEngine: ReturnType<typeof createTaskSyncEngine>;

  beforeEach(() => {
    syncEngine = createTaskSyncEngine();
  });

  describe('get', () => {
    it('should return null for unknown task IDs', () => {
      expect(syncEngine.get('unknown-id')).toBeNull();
    });
  });

  describe('applySnapshot', () => {
    it('should add a TaskEnvelope and return it', () => {
      const task: TaskEnvelope = {
        id: 'task-1',
        capability: 'patch',
        state: 'running',
        request: { instruction: 'test instruction' },
        createdAt: new Date().toISOString(),
      };

      const result = syncEngine.applySnapshot(task);
      expect(result).toEqual(task);
      expect(syncEngine.get('task-1')).toEqual(task);
    });

    it('should overwrite an existing TaskEnvelope', () => {
      const task1: TaskEnvelope = {
        id: 'task-1',
        capability: 'patch',
        state: 'running',
        request: { instruction: 'old instruction' },
        createdAt: new Date().toISOString(),
      };
      syncEngine.applySnapshot(task1);

      const task2: TaskEnvelope = {
        id: 'task-1',
        capability: 'execute',
        state: 'completed',
        request: { instruction: 'new instruction' },
        createdAt: new Date().toISOString(),
      };
      const result = syncEngine.applySnapshot(task2);

      expect(result).toEqual(task2);
      expect(syncEngine.get('task-1')).toEqual(task2);
    });
  });

  describe('applyEvent', () => {
    it('should create a base TaskEnvelope when one does not exist', () => {
      const event: TaskEvent = {
        id: 'event-1',
        type: 'created',
        taskId: 'task-new',
      };

      const result = syncEngine.applyEvent(event);

      expect(result.id).toBe('task-new');
      expect(result.capability).toBe('patch');
      expect(result.state).toBe('accepted');
      expect(result.request.instruction).toBe('');
      expect(result.createdAt).toBeDefined();

      expect(syncEngine.get('task-new')).toEqual(result);
    });

    it('should update an existing TaskEnvelope with state and attempt', () => {
      const task: TaskEnvelope = {
        id: 'task-update',
        capability: 'patch',
        state: 'accepted',
        request: { instruction: 'test' },
        createdAt: new Date().toISOString(),
      };
      syncEngine.applySnapshot(task);

      const event: TaskEvent = {
        type: 'updated',
        taskId: 'task-update',
        state: 'running',
        attempt: 2,
      };

      const result = syncEngine.applyEvent(event);

      expect(result.state).toBe('running');
      expect(result.attempt).toBe(2);
      expect(result.id).toBe('task-update');
    });

    it('should handle failures with valid category', () => {
      const event: TaskEvent = {
        type: 'failed',
        taskId: 'task-fail-valid',
        failure: {
          code: 'ERR_1',
          category: 'runtime',
        },
      };

      const result = syncEngine.applyEvent(event);

      expect(result.failure).toBeDefined();
      expect(result.failure?.code).toBe('ERR_1');
      expect(result.failure?.category).toBe('runtime');
      expect(result.failure?.message).toBe(''); // defaulted
    });

    it('should handle failures with invalid category, coercing to undefined', () => {
      const event: TaskEvent = {
        type: 'failed',
        taskId: 'task-fail-invalid',
        failure: {
          code: 'ERR_2',
          category: 'unknown-category',
        },
      };

      const result = syncEngine.applyEvent(event);

      expect(result.failure).toBeDefined();
      expect(result.failure?.code).toBe('ERR_2');
      expect(result.failure?.category).toBeUndefined();
    });

    it('should merge failure over existing failure', () => {
      const task: TaskEnvelope = {
        id: 'task-fail-merge',
        capability: 'patch',
        state: 'failed',
        request: { instruction: 'test' },
        createdAt: new Date().toISOString(),
        failure: {
          code: 'OLD_ERR',
          category: 'policy',
          message: 'old message',
          retryable: true,
        },
      };
      syncEngine.applySnapshot(task);

      const event: TaskEvent = {
        type: 'failed',
        taskId: 'task-fail-merge',
        failure: {
          code: 'NEW_ERR',
          // category omitted to test fallback to base
        },
      };

      const result = syncEngine.applyEvent(event);

      expect(result.failure).toBeDefined();
      expect(result.failure?.code).toBe('NEW_ERR');
      expect(result.failure?.category).toBe('policy'); // fallback to base
      expect(result.failure?.message).toBe('old message'); // fallback to base
      expect(result.failure?.retryable).toBe(true); // fallback to base
    });

    it('should handle required actions', () => {
      const event: TaskEvent = {
        type: 'input_required',
        taskId: 'task-input',
        requiredAction: {
          type: 'ask_user',
          reason: 'clarification',
        },
      };

      const result = syncEngine.applyEvent(event);

      expect(result.inputRequired).toBeDefined();
      expect(result.inputRequired?.type).toBe('ask_user');
      expect(result.inputRequired?.reason).toBe('clarification');
      expect(result.inputRequired?.prompt).toBe(''); // defaulted
    });

    it('should merge required actions over existing required action', () => {
      const task: TaskEnvelope = {
        id: 'task-input-merge',
        capability: 'patch',
        state: 'awaiting_input',
        request: { instruction: 'test' },
        createdAt: new Date().toISOString(),
        inputRequired: {
          type: 'old_type',
          prompt: 'Please help',
          reason: 'approval',
        },
      };
      syncEngine.applySnapshot(task);

      const event: TaskEvent = {
        type: 'input_required',
        taskId: 'task-input-merge',
        requiredAction: {
          type: 'new_type',
          // reason omitted to test undefined
        },
      };

      const result = syncEngine.applyEvent(event);

      expect(result.inputRequired).toBeDefined();
      expect(result.inputRequired?.type).toBe('new_type');
      expect(result.inputRequired?.reason).toBeUndefined(); // event reason maps directly to reason, overrides old
      expect(result.inputRequired?.prompt).toBe('Please help'); // fallback to base
    });
  });
});
