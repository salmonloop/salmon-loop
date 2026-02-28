import { projectCanonicalTaskToA2ATask } from '../task-projection.js';

import { A2AJsonRpcError } from './jsonrpc-error.js';

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
  status?: {
    state: string;
    timestamp: string;
    message?: string;
  };
  requiredAction?: {
    type: string;
    prompt: string;
  };
  artifacts?: Array<{
    artifactId: string;
    name: string;
    kind: string;
    mimeType?: string;
  }>;
  metadata?: {
    capability?: string;
    tenantId?: string;
  };
}

interface JsonRpcTaskListResult {
  items: JsonRpcTaskResult[];
}

interface CanonicalTaskResult {
  id: string;
  state: string;
  capability?: string;
  tenantId?: string;
  createdAt?: string;
  statusMessage?: string;
  inputRequired?: {
    type: string;
    prompt: string;
  };
  artifacts?: Array<{
    id: string;
    name: string;
    kind: string;
    mimeType?: string;
  }>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string;
  result: JsonRpcTaskResult | JsonRpcTaskListResult;
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
    }) => Promise<CanonicalTaskResult>;
    getTask?: (id: string) => Promise<CanonicalTaskResult | null>;
    cancelTask?: (id: string) => Promise<CanonicalTaskResult | null>;
    listTasks?: () => Promise<CanonicalTaskResult[]>;
  };
}) {
  return {
    async handle(request: unknown): Promise<JsonRpcResponse> {
      if (!isJsonRpcRequest(request)) {
        throw new A2AJsonRpcError({
          code: -32600,
          message: 'Invalid JSON-RPC request',
          status: 400,
        });
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
          result: projectCanonicalTaskToA2ATask(task),
        };
      }

      if (request.method === 'tasks/get' && deps.facade.getTask && request.params.id) {
        const task = await deps.facade.getTask(request.params.id);
        if (!task) {
          throw new A2AJsonRpcError({
            code: -32004,
            message: `Task not found: ${request.params.id}`,
            status: 404,
          });
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: projectCanonicalTaskToA2ATask(task),
        };
      }

      if (request.method === 'tasks/cancel' && deps.facade.cancelTask && request.params.id) {
        const task = await deps.facade.cancelTask(request.params.id);
        if (!task) {
          throw new A2AJsonRpcError({
            code: -32004,
            message: `Task not found: ${request.params.id}`,
            status: 404,
          });
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: projectCanonicalTaskToA2ATask(task),
        };
      }

      if (request.method === 'tasks/list' && deps.facade.listTasks) {
        const tasks = await deps.facade.listTasks();
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            items: tasks.map((task) => projectCanonicalTaskToA2ATask(task)),
          },
        };
      }

      throw new A2AJsonRpcError({
        code: -32601,
        message: `Unsupported method: ${request.method}`,
        status: 400,
      });
    },
  };
}
