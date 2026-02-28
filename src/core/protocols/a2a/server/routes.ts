import type { A2AAuthPolicyMiddleware } from './auth-policy.js';
import { isA2AJsonRpcError } from './jsonrpc-error.js';

function buildJsonRpcError(params: {
  id: string | null;
  code: number;
  message: string;
  status?: number;
  data?: Record<string, unknown>;
}): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: params.id,
      error: {
        code: params.code,
        message: params.message,
        ...(params.data ? { data: params.data } : {}),
      },
    },
    { status: params.status ?? 400 },
  );
}

function buildRpcPolicyContext(payload: unknown): {
  action: string;
  resource: string;
  taskId?: string;
} {
  if (!payload || typeof payload !== 'object') {
    return { action: 'rpc.invoke', resource: 'rpc' };
  }

  const method =
    'method' in payload && typeof payload.method === 'string' ? payload.method : undefined;
  const params =
    'params' in payload && payload.params && typeof payload.params === 'object'
      ? (payload.params as Record<string, unknown>)
      : undefined;
  const taskId = typeof params?.id === 'string' ? params.id : undefined;

  if (method === 'tasks/get') return { action: 'task.get', resource: 'task', taskId };
  if (method === 'tasks/list') return { action: 'task.list', resource: 'task' };
  if (method === 'tasks/cancel') return { action: 'task.cancel', resource: 'task', taskId };
  if (method === 'tasks/resume') return { action: 'task.resume', resource: 'task', taskId };
  if (method === 'tasks/retry') return { action: 'task.retry', resource: 'task', taskId };
  if (method === 'tasks/reopen') return { action: 'task.reopen', resource: 'task', taskId };
  if (method === 'tasks/submitInput') {
    return { action: 'task.submit_input', resource: 'task', taskId };
  }
  if (method === 'tasks/getArtifact') {
    return { action: 'task.get_artifact', resource: 'task', taskId };
  }
  if (method === 'message/send') return { action: 'message.send', resource: 'message' };

  return { action: 'rpc.invoke', resource: 'rpc' };
}

export function createA2ARoutes(deps: {
  buildAgentCard: () => unknown;
  jsonRpcHandler: {
    handle: (request: unknown) => Promise<unknown>;
  };
  eventSource: {
    open: (taskId: string, request?: Request) => Response;
  };
  artifactStore?: {
    read: (handle: string) => Promise<Response | null>;
  };
  authPolicy?: A2AAuthPolicyMiddleware;
}) {
  return {
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/.well-known/agent-card.json') {
        return Response.json(deps.buildAgentCard());
      }

      const subscribeMatch = url.pathname.match(/^\/tasks\/([^/]+)\/subscribe$/);
      if (request.method === 'GET' && subscribeMatch) {
        if (deps.authPolicy) {
          const decision = await deps.authPolicy.authorize({
            request,
            action: 'task.subscribe',
            resource: 'task',
            taskId: subscribeMatch[1],
          });
          if (!decision.allowed) {
            return new Response(decision.message, { status: decision.status });
          }
        }
        return deps.eventSource.open(subscribeMatch[1], request);
      }

      const artifactMatch = url.pathname.match(/^\/artifacts\/([^/]+)$/);
      if (request.method === 'GET' && artifactMatch && deps.artifactStore) {
        const response = await deps.artifactStore.read(artifactMatch[1]);
        return response ?? new Response('Not Found', { status: 404 });
      }

      if (request.method === 'POST' && url.pathname === '/rpc') {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return buildJsonRpcError({
            id: null,
            code: -32700,
            message: 'Parse error',
            status: 400,
          });
        }
        if (deps.authPolicy) {
          const policyContext = buildRpcPolicyContext(payload);
          const decision = await deps.authPolicy.authorize({
            request,
            action: policyContext.action,
            resource: policyContext.resource,
            taskId: policyContext.taskId,
          });
          if (!decision.allowed) {
            const id =
              payload &&
              typeof payload === 'object' &&
              'id' in payload &&
              typeof payload.id === 'string'
                ? payload.id
                : null;
            return buildJsonRpcError({
              id,
              code: decision.status === 401 ? -32001 : -32003,
              message: decision.message,
              status: decision.status,
            });
          }
        }
        try {
          const result = await deps.jsonRpcHandler.handle(payload);
          return Response.json(result);
        } catch (error) {
          const id =
            payload &&
            typeof payload === 'object' &&
            'id' in payload &&
            typeof payload.id === 'string'
              ? payload.id
              : null;
          if (isA2AJsonRpcError(error)) {
            return buildJsonRpcError({
              id,
              code: error.code,
              message: error.message,
              status: error.status,
              data: error.data,
            });
          }

          const message = error instanceof Error ? error.message : 'Internal error';
          return buildJsonRpcError({
            id,
            code: -32603,
            message,
            status: 500,
          });
        }
      }

      return new Response('Not Found', { status: 404 });
    },
  };
}
