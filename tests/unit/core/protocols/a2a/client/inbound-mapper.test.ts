import { describe, expect, test } from 'bun:test';

import { mapA2ATaskResultToCanonicalTask } from '../../../../../../src/core/protocols/a2a/client/inbound-mapper.js';

describe('A2A inbound mapper', () => {
  test('maps A2A task result into canonical task snapshot', () => {
    const task = mapA2ATaskResultToCanonicalTask({
      id: 'task_1',
      state: 'completed',
      status: { state: 'completed', timestamp: '2026-02-28T00:00:00.000Z' },
      failure: {
        code: 'VERIFY_FAILED',
        category: 'verification',
        message: 'needs approval',
        retryable: true,
      },
      requiredAction: {
        type: 'confirmation',
        reason: 'approval',
        prompt: 'approve?',
      },
      artifacts: [{ artifactId: 'a1', name: 'diff', kind: 'patch', content: '...' }],
      metadata: { capability: 'patch', tenantId: 't1', attempt: 2 },
    });

    expect(task).toMatchObject({
      id: 'task_1',
      state: 'completed',
      capability: 'patch',
      tenantId: 't1',
      attempt: 2,
      createdAt: '2026-02-28T00:00:00.000Z',
      failure: { code: 'VERIFY_FAILED', category: 'verification' },
      inputRequired: { type: 'confirmation', reason: 'approval' },
      artifacts: [{ id: 'a1', name: 'diff', kind: 'patch' }],
    });
  });
});
