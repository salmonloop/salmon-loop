import type { A2AAuthPolicyMiddleware } from './auth-policy.js';
import { isA2AJsonRpcError } from './jsonrpc-error.js';

function buildJsonRpcError(params: {
  id: string | null;
  code: number;
  message: string;
  status?: number;
}): Response {
  return Response.json(
    {
      jsonrpc: '2.0',
      id: params.id,
      error: {
        code: params.code,
        message: params.message,
      },
    },
    { status: params.status ?? 400 },
  );
}

export function createA2ARoutes(deps: {
  buildAgentCard: () => unknown;
  jsonRpcHandler: {
    handle: (request: unknown) => Promise<unknown>;
  };
  eventSource: {
    open: (taskId: string) => Response;
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
          const decision = await deps.authPolicy.authorize(request);
          if (!decision.allowed) {
            return new Response(decision.message, { status: decision.status });
          }
        }
        return deps.eventSource.open(subscribeMatch[1]);
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
          const decision = await deps.authPolicy.authorize(request);
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
