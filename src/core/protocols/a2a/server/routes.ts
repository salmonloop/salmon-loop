export function createA2ARoutes(deps: {
  buildAgentCard: () => unknown;
  jsonRpcHandler: {
    handle: (request: unknown) => Promise<unknown>;
  };
  eventSource: {
    open: (taskId: string) => Response;
  };
}) {
  return {
    async handle(request: Request): Promise<Response> {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/.well-known/agent-card.json') {
        return Response.json(deps.buildAgentCard());
      }

      const subscribeMatch = url.pathname.match(/^\/tasks\/([^/]+)\/subscribe$/);
      if (request.method === 'GET' && subscribeMatch) {
        return deps.eventSource.open(subscribeMatch[1]);
      }

      if (request.method === 'POST' && url.pathname === '/rpc') {
        let payload: unknown;
        try {
          payload = await request.json();
        } catch {
          return Response.json(
            {
              error: 'Invalid JSON body',
            },
            { status: 400 },
          );
        }
        const result = await deps.jsonRpcHandler.handle(payload);
        return Response.json(result);
      }

      return new Response('Not Found', { status: 404 });
    },
  };
}
