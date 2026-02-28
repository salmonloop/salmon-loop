interface JsonRpcRequest {
  method: string;
  params: {
    id?: string;
    message?: {
      role?: string;
      parts?: Array<{ type: string; text?: string }>;
    };
  };
  id: string;
}

interface JsonRpcTaskResult {
  id: string;
  state: string;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result: JsonRpcTaskResult;
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.method === 'string' && typeof candidate.id === 'string';
}

export function createA2AJsonRpcHandler(deps: {
  facade: {
    createTask: (input: {
      capability: string;
      request: { instruction: string };
    }) => Promise<JsonRpcTaskResult>;
    getTask?: (id: string) => Promise<JsonRpcTaskResult | null>;
    cancelTask?: (id: string) => Promise<JsonRpcTaskResult | null>;
  };
}) {
  return {
    async handle(request: unknown): Promise<JsonRpcResponse> {
      if (!isJsonRpcRequest(request)) {
        throw new Error('Invalid JSON-RPC request');
      }

      if (request.method === 'message/send') {
        const instruction = (request.params.message?.parts ?? [])
          .filter((part) => part.type === 'text' && typeof part.text === 'string')
          .map((part) => part.text)
          .join('\n');

        const task = await deps.facade.createTask({
          capability: 'patch',
          request: { instruction },
        });

        return {
          jsonrpc: '2.0',
          id: request.id,
          result: task,
        };
      }

      if (request.method === 'tasks/get' && deps.facade.getTask && request.params.id) {
        const task = await deps.facade.getTask(request.params.id);
        if (!task) throw new Error(`Task not found: ${request.params.id}`);
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: task,
        };
      }

      if (request.method === 'tasks/cancel' && deps.facade.cancelTask && request.params.id) {
        const task = await deps.facade.cancelTask(request.params.id);
        if (!task) throw new Error(`Task not found: ${request.params.id}`);
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: task,
        };
      }

      throw new Error(`Unsupported method: ${request.method}`);
    },
  };
}
