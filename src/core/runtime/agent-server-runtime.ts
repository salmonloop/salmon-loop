import type { AgentCard } from '@a2a-js/sdk';
import type { TaskStore } from '@a2a-js/sdk/server';
import { InMemoryTaskStore } from '@a2a-js/sdk/server';
import type { UserBuilder as A2AUserBuilder } from '@a2a-js/sdk/server/express';
import type { Express, RequestHandler } from 'express';

import { createTaskEventBus } from '../interaction/events/bus.js';
import type { TaskEventBus } from '../interaction/events/bus.js';
import type { TaskEnvelope } from '../interaction/model/index.js';
import { createInteractionFacade } from '../interaction/orchestration/facade.js';
import { createA2AInteractionExecutor } from '../protocols/a2a/sdk/executor.js';
import { createA2ASdkExpressApp } from '../protocols/a2a/sdk/server.js';

import { type FastifyFactory, type FastifyListenOptions } from './fastify-server-bundle.js';
import {
  createSidecarFastifyPlugin,
  type RouteDescriptor,
  type SidecarPolicyDecision,
} from './sidecar-fastify-plugin.js';

export type AgentServerRuntime = {
  eventBus: TaskEventBus;
  a2aServer: Express;
  sidecarServer: ReturnType<FastifyFactory>;
  start: () => Promise<void>;
  close: () => Promise<void>;
};

export function createAgentServerRuntime(deps: {
  createFastify: FastifyFactory;
  a2a: {
    buildAgentCard: () => AgentCard;
    executeTask: (task: TaskEnvelope, options?: { signal?: AbortSignal }) => Promise<TaskEnvelope>;
    authMiddleware?: RequestHandler;
    userBuilder?: A2AUserBuilder;
    taskStore?: TaskStore;
    eventBus?: TaskEventBus;
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
    a2a: { port: number; host?: string };
    sidecar: FastifyListenOptions;
  };
  a2aBaseUrl?: string;
  configureA2A?: (app: Express) => Promise<void> | void;
  configureSidecar?: (instance: ReturnType<FastifyFactory>) => Promise<void> | void;
}) {
  const eventBus = deps.a2a.eventBus ?? createTaskEventBus();
  const taskStore = deps.a2a.taskStore ?? new InMemoryTaskStore();

  const facade = createInteractionFacade({
    executeTask: deps.a2a.executeTask,
    eventBus,
  });

  const executor = createA2AInteractionExecutor({
    facade: {
      createTask: (input) => facade.createTask(input).then((result) => ({ task: result.task })),
      getTask: (id) => facade.getTask(id),
      cancelTask: (id) => facade.cancelTask(id),
    },
    taskEventBus: eventBus,
    taskStore,
  });

  const agentCard = deps.a2a.buildAgentCard();

  const a2aApp = createA2ASdkExpressApp({
    agentCard,
    agentExecutor: executor,
    taskStore,
    userBuilder: deps.a2a.userBuilder,
    authMiddleware: deps.a2a.authMiddleware,
  });

  const sidecarPlugin = createSidecarFastifyPlugin({
    routes: deps.sidecar.routes,
    scope: 'uds',
    allowConditional: deps.sidecar.allowConditional,
    authorize: deps.sidecar.authorize,
    baseUrl: deps.sidecar.baseUrl,
  });

  const sidecarServer = deps.createFastify();
  let a2aServerInstance: ReturnType<typeof a2aApp.listen> | null = null;
  let sidecarServerInstance: ReturnType<typeof sidecarServer.listen> | null = null;
  let started = false;

  async function start(): Promise<void> {
    if (started) {
      throw new Error('Runtime already started');
    }

    if (deps.configureA2A) {
      await deps.configureA2A(a2aApp);
    }

    if (deps.configureSidecar) {
      await deps.configureSidecar(sidecarServer);
    }
    await sidecarServer.register(sidecarPlugin);

    a2aServerInstance = await new Promise((resolve, reject) => {
      const server = a2aApp.listen(
        deps.listen.a2a.port,
        deps.listen.a2a.host ?? '0.0.0.0',
        (err?: Error) => {
          if (err) reject(err);
          else resolve(server);
        },
      );
    });

    sidecarServerInstance = await sidecarServer.listen(deps.listen.sidecar);
    started = true;
  }

  async function close(): Promise<void> {
    if (a2aServerInstance) {
      await new Promise<void>((resolve) => {
        a2aServerInstance!.close(() => resolve());
      });
      a2aServerInstance = null;
    }

    if (sidecarServerInstance) {
      await sidecarServer.close();
      sidecarServerInstance = null;
    }

    started = false;
  }

  return {
    eventBus,
    a2aServer: a2aApp,
    sidecarServer,
    start,
    close,
  };
}
