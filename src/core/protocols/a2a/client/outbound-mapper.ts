import type { A2AJsonRpcRequest, A2AOutboundAction } from './types.js';

export function buildA2AJsonRpcRequest(input: A2AOutboundAction): A2AJsonRpcRequest {
  if (input.action === 'start') {
    return {
      jsonrpc: '2.0',
      id: input.requestId,
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ type: 'text', text: input.instruction }],
        },
      },
    };
  }

  if (input.action === 'get') {
    return {
      jsonrpc: '2.0',
      id: input.requestId,
      method: 'tasks/get',
      params: {
        id: input.taskId,
        ...(input.sinceEventId ? { sinceEventId: input.sinceEventId } : {}),
        ...(typeof input.replayLimit === 'number' ? { replayLimit: input.replayLimit } : {}),
        ...(input.requireReplay ? { requireReplay: true } : {}),
      },
    };
  }

  if (input.action === 'retry') {
    return {
      jsonrpc: '2.0',
      id: input.requestId,
      method: 'tasks/retry',
      params: { id: input.taskId },
    };
  }

  if (input.action === 'reopen') {
    return {
      jsonrpc: '2.0',
      id: input.requestId,
      method: 'tasks/reopen',
      params: {
        id: input.taskId,
        ...(input.prompt ? { input: { type: 'message', value: input.prompt } } : {}),
      },
    };
  }

  return {
    jsonrpc: '2.0',
    id: input.requestId,
    method: 'tasks/submitInput',
    params: { id: input.taskId, input: input.input },
  };
}
