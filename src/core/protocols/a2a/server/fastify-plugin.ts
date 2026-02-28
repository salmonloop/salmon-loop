import {
  buildFetchRequest,
  sendFetchResponse,
  type FastifyReplyLike,
  type FastifyRequestLike,
} from '../../../runtime/fastify-fetch-bridge.js';

type FastifyInstanceLike = {
  route: (options: {
    method: string;
    url: string;
    handler: (request: FastifyRequestLike, reply: FastifyReplyLike) => Promise<void>;
  }) => void;
};

type A2ARoutes = {
  handle: (request: Request) => Promise<Response>;
};

export function createA2AFastifyPlugin(deps: { routes: A2ARoutes; baseUrl?: string }) {
  const baseUrl = deps.baseUrl ?? 'http://localhost';

  return async function a2aFastifyPlugin(fastify: FastifyInstanceLike): Promise<void> {
    const handler = async (request: FastifyRequestLike, reply: FastifyReplyLike) => {
      const converted = buildFetchRequest(request, baseUrl);
      const response = await deps.routes.handle(converted);
      await sendFetchResponse(reply, response);
    };

    fastify.route({ method: 'GET', url: '/.well-known/agent-card.json', handler });
    fastify.route({ method: 'POST', url: '/rpc', handler });
    fastify.route({ method: 'GET', url: '/tasks/:taskId/subscribe', handler });
    fastify.route({ method: 'GET', url: '/artifacts/:artifactId', handler });
  };
}
