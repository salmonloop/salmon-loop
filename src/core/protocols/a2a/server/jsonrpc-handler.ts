import { projectCanonicalTaskToA2ATask } from '../task-projection.js';

import { A2AJsonRpcError } from './jsonrpc-error.js';

interface JsonRpcRequest {
  method: string;
  params: {
    id?: string;
    artifactId?: string;
    capability?: string;
    state?: string;
    limit?: number;
    cursor?: string;
    input?: {
      type: string;
      value: string;
    };
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
  failure?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
  artifacts?: Array<{
    artifactId: string;
    name: string;
    kind: string;
    mimeType?: string;
    content?: string;
    delivery?: 'inline' | 'handle' | 'url';
    handle?: string;
    url?: string;
    expiresAt?: string;
  }>;
  metadata?: {
    capability?: string;
    tenantId?: string;
    attempt?: number;
  };
}

interface JsonRpcTaskListResult {
  items: JsonRpcTaskResult[];
  nextCursor?: string;
}

interface CanonicalTaskResult {
  id: string;
  state: string;
  capability?: string;
  tenantId?: string;
  createdAt?: string;
  attempt?: number;
  statusMessage?: string;
  failure?: {
    code: string;
    message: string;
    retryable?: boolean;
  };
  inputRequired?: {
    type: string;
    prompt: string;
  };
  artifacts?: Array<{
    id: string;
    name: string;
    kind: string;
    mimeType?: string;
    content?: string;
    delivery?: 'inline' | 'handle' | 'url';
    handle?: string;
    url?: string;
    expiresAt?: string;
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
    resumeTask?: (id: string) => Promise<CanonicalTaskResult | null>;
    retryTask?: (id: string) => Promise<CanonicalTaskResult | null>;
    reopenTask?: (
      id: string,
      action?: { type: string; prompt: string },
    ) => Promise<CanonicalTaskResult | null>;
    listTasks?: (query?: {
      capability?: string;
      state?: string;
      limit?: number;
      cursor?: string;
    }) => Promise<{ items: CanonicalTaskResult[]; nextCursor?: string } | CanonicalTaskResult[]>;
    submitInput?: (
      id: string,
      input: { type: string; value: string },
    ) => Promise<CanonicalTaskResult | null>;
    getArtifact?: (id: string, artifactId: string) => Promise<CanonicalTaskResult | null>;
  };
}) {
  function selectArtifact(
    task: CanonicalTaskResult,
    artifactId: string,
  ): CanonicalTaskResult | null {
    const artifact = task.artifacts?.find((candidate) => candidate.id === artifactId);
    if (!artifact) return null;
    return {
      ...task,
      artifacts: [artifact],
    };
  }

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

      if (request.method === 'tasks/resume' && deps.facade.resumeTask && request.params.id) {
        const task = await deps.facade.resumeTask(request.params.id);
        if (!task) {
          const existingTask = deps.facade.getTask
            ? await deps.facade.getTask(request.params.id)
            : null;
          if (existingTask) {
            throw new A2AJsonRpcError({
              code: -32009,
              message: `Task is not resumable: ${request.params.id}`,
              status: 409,
            });
          }
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

      if (request.method === 'tasks/retry' && deps.facade.retryTask && request.params.id) {
        const task = await deps.facade.retryTask(request.params.id);
        if (!task) {
          const existingTask = deps.facade.getTask
            ? await deps.facade.getTask(request.params.id)
            : null;
          if (existingTask) {
            throw new A2AJsonRpcError({
              code: -32009,
              message: `Task is not retryable: ${request.params.id}`,
              status: 409,
            });
          }
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

      if (request.method === 'tasks/reopen' && deps.facade.reopenTask && request.params.id) {
        const task = await deps.facade.reopenTask(request.params.id, {
          type: 'confirmation',
          prompt: 'Provide updated approval',
        });
        if (!task) {
          const existingTask = deps.facade.getTask
            ? await deps.facade.getTask(request.params.id)
            : null;
          if (existingTask) {
            throw new A2AJsonRpcError({
              code: -32009,
              message: `Task is not reopenable: ${request.params.id}`,
              status: 409,
            });
          }
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
        const tasks = await deps.facade.listTasks({
          capability: request.params.capability,
          state: request.params.state,
          limit: request.params.limit,
          cursor: request.params.cursor,
        });
        const items = Array.isArray(tasks) ? tasks : tasks.items;
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            items: items.map((task) => projectCanonicalTaskToA2ATask(task)),
            nextCursor: Array.isArray(tasks) ? undefined : tasks.nextCursor,
          },
        };
      }

      if (request.method === 'tasks/submitInput' && deps.facade.submitInput && request.params.id) {
        if (!request.params.input) {
          throw new A2AJsonRpcError({
            code: -32600,
            message: 'Invalid JSON-RPC request',
            status: 400,
          });
        }
        const task = await deps.facade.submitInput(request.params.id, request.params.input);
        if (!task) {
          const existingTask = deps.facade.getTask
            ? await deps.facade.getTask(request.params.id)
            : null;
          if (existingTask) {
            throw new A2AJsonRpcError({
              code: -32009,
              message: `Task is not awaiting input: ${request.params.id}`,
              status: 409,
            });
          }
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

      if (
        request.method === 'tasks/getArtifact' &&
        deps.facade.getArtifact &&
        request.params.id &&
        request.params.artifactId
      ) {
        const task = await deps.facade.getArtifact(request.params.id, request.params.artifactId);
        if (!task) {
          throw new A2AJsonRpcError({
            code: -32004,
            message: `Artifact not found: ${request.params.artifactId}`,
            status: 404,
          });
        }
        const selectedTask = selectArtifact(task, request.params.artifactId);
        if (!selectedTask) {
          throw new A2AJsonRpcError({
            code: -32004,
            message: `Artifact not found: ${request.params.artifactId}`,
            status: 404,
          });
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: projectCanonicalTaskToA2ATask(selectedTask),
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
