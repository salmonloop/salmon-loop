import {
  buildFetchRequest,
  sendFetchResponse,
  type FastifyReplyLike,
  type FastifyRequestLike,
} from './fastify-fetch-bridge.js';

export type RouteExposure = 'essential' | 'conditional' | 'forbidden';
export type RouteScope = 'tcp' | 'uds' | 'both';

export type RouteDescriptor = {
  method: string;
  path: string;
  exposure: RouteExposure;
  scope: RouteScope;
  policyTag: string;
  handler: (request: Request) => Promise<Response>;
};

type FastifyInstanceLike = {
  route: (options: {
    method: string;
    url: string;
    handler: (request: FastifyRequestLike, reply: FastifyReplyLike) => Promise<void>;
  }) => void;
};

export type SidecarPolicyDecision =
  | { allowed: true }
  | { allowed: false; status?: number; message?: string };

export function createSidecarFastifyPlugin(deps: {
  routes: RouteDescriptor[];
  scope: Exclude<RouteScope, 'both'>;
  baseUrl?: string;
  allowConditional?: boolean;
  authorize?: (input: {
    request: Request;
    policyTag: string;
    scope: Exclude<RouteScope, 'both'>;
  }) => Promise<SidecarPolicyDecision>;
}) {
  const baseUrl = deps.baseUrl ?? 'http://localhost';
  const allowConditional = deps.allowConditional ?? false;

  return async function sidecarFastifyPlugin(fastify: FastifyInstanceLike): Promise<void> {
    for (const route of deps.routes) {
      if (route.exposure === 'forbidden') continue;
      if (route.scope !== 'both' && route.scope !== deps.scope) continue;
      if (!allowConditional && route.exposure === 'conditional') continue;

      const handler = async (request: FastifyRequestLike, reply: FastifyReplyLike) => {
        const fetchRequest = buildFetchRequest(request, baseUrl);
        if (deps.authorize) {
          const decision = await deps.authorize({
            request: fetchRequest,
            policyTag: route.policyTag,
            scope: deps.scope,
          });
          if (!decision.allowed) {
            await sendFetchResponse(
              reply,
              new Response(decision.message ?? 'Forbidden', {
                status: decision.status ?? 403,
              }),
            );
            return;
          }
        }

        const response = await route.handler(fetchRequest);
        await sendFetchResponse(reply, response);
      };

      fastify.route({ method: route.method, url: route.path, handler });
    }
  };
}
