import { describe, expect, test } from 'bun:test';

import { buildA2AJsonRpcRequest } from '../../../../../../src/core/protocols/a2a/client/outbound-mapper.js';

describe('A2A outbound mapper', () => {
  test('builds message/send request from canonical instruction', () => {
    const payload = buildA2AJsonRpcRequest({
      requestId: 'req-1',
      action: 'start',
      instruction: 'fix bug',
    });

    expect(payload).toEqual({
      jsonrpc: '2.0',
      id: 'req-1',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: 'fix bug' }],
        },
      },
    });
  });

  test('builds tasks/get request', () => {
    const payload = buildA2AJsonRpcRequest({
      requestId: 'req-2',
      action: 'get',
      taskId: 'task_1',
    });

    expect(payload).toEqual({
      jsonrpc: '2.0',
      id: 'req-2',
      method: 'tasks/get',
      params: { id: 'task_1' },
    });
  });
});
