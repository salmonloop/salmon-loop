import { describe, expect, test } from 'bun:test';

import { mapA2ATaskToCanonicalTask } from '../../../../../src/core/protocols/a2a/mapper.js';

describe('A2A mapper', () => {
  test('maps an A2A message request into a canonical task', () => {
    const task = mapA2ATaskToCanonicalTask({
      id: 'a2a_task_1',
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'fix bug' }],
      },
      metadata: {},
    });

    expect(task.id).toBe('a2a_task_1');
    expect(task.request.instruction).toContain('fix bug');
  });
});
