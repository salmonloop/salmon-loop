import { describe, expect, test, beforeEach } from 'bun:test';

import type { TaskEnvelope } from '../../../../../src/core/interaction/model/index.js';
import { InMemoryTaskStore } from '../../../../../src/core/interaction/orchestration/store.js';

describe('InMemoryTaskStore', () => {
  let store: InMemoryTaskStore;

  const createTask = (
    id: string,
    capability: string = 'test-cap',
    state: TaskEnvelope['state'] = 'accepted',
  ): TaskEnvelope => ({
    id,
    capability,
    state,
    request: { instruction: `instruction for ${id}` },
    createdAt: new Date().toISOString(),
  });

  beforeEach(() => {
    store = new InMemoryTaskStore();
  });

  describe('save & get', () => {
    test('should save and retrieve a task by id', () => {
      const task = createTask('task-1');
      store.save(task);

      const retrieved = store.get('task-1');
      expect(retrieved).toEqual(task);
      expect(retrieved).not.toBeNull();
    });

    test('should return null for a non-existent task id', () => {
      const retrieved = store.get('non-existent');
      expect(retrieved).toBeNull();
    });
  });

  describe('update', () => {
    test('should update an existing task and return it', () => {
      const task = createTask('task-1', 'cap-a', 'accepted');
      store.save(task);

      const updatedTask = { ...task, state: 'completed' as const };
      const returned = store.update(updatedTask);

      expect(returned).toEqual(updatedTask);
      expect(store.get('task-1')).toEqual(updatedTask);
    });
  });

  describe('list', () => {
    beforeEach(() => {
      store.save(createTask('task-1', 'cap-a', 'accepted'));
      store.save(createTask('task-2', 'cap-b', 'running'));
      store.save(createTask('task-3', 'cap-a', 'completed'));
      store.save(createTask('task-4', 'cap-c', 'failed'));
      store.save(createTask('task-5', 'cap-a', 'running'));
    });

    test('should list all tasks when no query is provided', () => {
      const result = store.list();
      expect(result.items).toHaveLength(5);
      expect(result.items.map((t) => t.id)).toEqual([
        'task-1',
        'task-2',
        'task-3',
        'task-4',
        'task-5',
      ]);
      expect(result.nextCursor).toBeUndefined();
    });

    test('should filter by capability', () => {
      const result = store.list({ capability: 'cap-a' });
      expect(result.items).toHaveLength(3);
      expect(result.items.map((t) => t.id)).toEqual(['task-1', 'task-3', 'task-5']);
    });

    test('should filter by state', () => {
      const result = store.list({ state: 'running' });
      expect(result.items).toHaveLength(2);
      expect(result.items.map((t) => t.id)).toEqual(['task-2', 'task-5']);
    });

    test('should apply both capability and state filters', () => {
      const result = store.list({ capability: 'cap-a', state: 'completed' });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('task-3');
    });

    test('should apply limit and return nextCursor if more items exist', () => {
      const result = store.list({ limit: 2 });
      expect(result.items).toHaveLength(2);
      expect(result.items.map((t) => t.id)).toEqual(['task-1', 'task-2']);
      expect(result.nextCursor).toBe('task-2');
    });

    test('should NOT return nextCursor if limit is exactly total items', () => {
      const result = store.list({ limit: 5 });
      expect(result.items).toHaveLength(5);
      expect(result.nextCursor).toBeUndefined();
    });

    test('should NOT return nextCursor if limit is greater than total items', () => {
      const result = store.list({ limit: 10 });
      expect(result.items).toHaveLength(5);
      expect(result.nextCursor).toBeUndefined();
    });

    test('should paginate using cursor', () => {
      const firstPage = store.list({ limit: 2 });
      expect(firstPage.nextCursor).toBe('task-2');

      const secondPage = store.list({ cursor: firstPage.nextCursor, limit: 2 });
      expect(secondPage.items).toHaveLength(2);
      expect(secondPage.items.map((t) => t.id)).toEqual(['task-3', 'task-4']);
      expect(secondPage.nextCursor).toBe('task-4');

      const thirdPage = store.list({ cursor: secondPage.nextCursor, limit: 2 });
      expect(thirdPage.items).toHaveLength(1);
      expect(thirdPage.items[0].id).toBe('task-5');
      expect(thirdPage.nextCursor).toBeUndefined();
    });

    test('should paginate correctly with filters', () => {
      const firstPage = store.list({ capability: 'cap-a', limit: 2 });
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.items.map((t) => t.id)).toEqual(['task-1', 'task-3']);
      expect(firstPage.nextCursor).toBe('task-3');

      const secondPage = store.list({
        capability: 'cap-a',
        cursor: firstPage.nextCursor,
        limit: 2,
      });
      expect(secondPage.items).toHaveLength(1);
      expect(secondPage.items[0].id).toBe('task-5');
      expect(secondPage.nextCursor).toBeUndefined();
    });

    test('should handle unknown cursor gracefully by acting as if no cursor (returning all from start or as filtered/limited)', () => {
      const result = store.list({ cursor: 'unknown-task' });
      expect(result.items).toHaveLength(5);
    });
  });
});
