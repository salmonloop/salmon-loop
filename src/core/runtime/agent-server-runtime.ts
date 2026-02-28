import { createTaskEventBus } from '../interaction/events/bus.js';
import type { TaskEventBus } from '../interaction/events/bus.js';
import type { TaskEnvelope } from '../interaction/model/index.js';
import { createInteractionFacade } from '../interaction/orchestration/facade.js';
import type { A2AAuthPolicyMiddleware } from '../protocols/a2a/server/auth-policy.js';
import { createA2AFastifyPlugin } from '../protocols/a2a/server/fastify-plugin.js';
import { createA2AJsonRpcHandler } from '../protocols/a2a/server/jsonrpc-handler.js';
import { createA2ARoutes } from '../protocols/a2a/server/routes.js';
import { createSseEventSource } from '../protocols/a2a/server/sse-stream.js';

import {
  createFastifyServerBundle,
  type FastifyFactory,
  type FastifyListenOptions,
} from './fastify-server-bundle.js';
import {
  createSidecarFastifyPlugin,
  type RouteDescriptor,
  type SidecarPolicyDecision,
} from './sidecar-fastify-plugin.js';

export type AgentServerRuntime = {
  eventBus: TaskEventBus;
  a2aServer: ReturnType<FastifyFactory>;
  sidecarServer: ReturnType<FastifyFactory>;
  start: () => Promise<void>;
  close: () => Promise<void>;
};

export function createAgentServerRuntime(deps: {
  createFastify: FastifyFactory;
  a2a: {
    buildAgentCard: () => unknown;
    executeTask: (task: TaskEnvelope) => Promise<TaskEnvelope>;
    authPolicy?: A2AAuthPolicyMiddleware;
    artifactStore?: {
      read: (handle: string) => Promise<Response | null>;
    };
    eventBus?: TaskEventBus;
    sse?: {
      maxReplayEvents?: number;
      heartbeatIntervalMs?: number;
      setInterval?: typeof globalThis.setInterval;
      clearInterval?: typeof globalThis.clearInterval;
    };
  };
  sidecar: {
    routes: RouteDescriptor[];
    allowConditional?: boolean;
    authorize?: (input: {
      request: Request;
      policyTag: string;
      scope: 'tcp' | 'uds';
    }) => Promise<SidecarPolicyDecision>;
    baseUrl?: string;
  };
  listen: {
    a2a: FastifyListenOptions;
    sidecar: FastifyListenOptions;
  };
  a2aBaseUrl?: string;
  configureA2A?: (instance: ReturnType<FastifyFactory>) => Promise<void> | void;
  configureSidecar?: (instance: ReturnType<FastifyFactory>) => Promise<void> | void;
}) {
  const eventBus = deps.a2a.eventBus ?? createTaskEventBus();
  const facade = createInteractionFacade({
    executeTask: deps.a2a.executeTask,
    eventBus,
  });
  const jsonRpcHandler = createA2AJsonRpcHandler({
    facade: {
      ...facade,
      async reopenTask(id, action) {
        if (!action) return null;
        return facade.reopenTask(id, action);
      },
    },
    eventBus,
  });
  const eventSource = createSseEventSource(eventBus, deps.a2a.sse);

  const routes = createA2ARoutes({
    buildAgentCard: deps.a2a.buildAgentCard,
    jsonRpcHandler,
    eventSource,
    artifactStore: deps.a2a.artifactStore,
    authPolicy: deps.a2a.authPolicy,
  });

  const a2aPlugin = createA2AFastifyPlugin({
    routes,
    baseUrl: deps.a2aBaseUrl,
  });

  const sidecarPlugin = createSidecarFastifyPlugin({
    routes: deps.sidecar.routes,
    scope: 'uds',
    allowConditional: deps.sidecar.allowConditional,
    authorize: deps.sidecar.authorize,
    baseUrl: deps.sidecar.baseUrl,
  });

  const bundle = createFastifyServerBundle({
    createFastify: deps.createFastify,
    a2aPlugin,
    sidecarPlugin,
    configureA2A: deps.configureA2A,
    configureSidecar: deps.configureSidecar,
    a2aListen: deps.listen.a2a,
    sidecarListen: deps.listen.sidecar,
  });

  return {
    eventBus,
    a2aServer: bundle.a2aServer,
    sidecarServer: bundle.sidecarServer,
    start: bundle.start,
    close: bundle.close,
  };
}
