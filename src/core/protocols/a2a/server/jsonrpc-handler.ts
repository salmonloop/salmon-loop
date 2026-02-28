interface JsonRpcRequest {
  method: string;
  params: {
    message?: {
      parts?: Array<{ type: string; text?: string }>;
    };
  };
  id: string;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result: unknown;
}

export function createA2AJsonRpcHandler(deps: {
  facade: {
    createTask: (input: {
      capability: string;
      request: { instruction: string };
    }) => Promise<unknown>;
  };
}) {
  return {
    async handle(request: JsonRpcRequest): Promise<JsonRpcResponse> {
      if (request.method !== 'message/send') {
        throw new Error(`Unsupported method: ${request.method}`);
      }

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
    },
  };
}
