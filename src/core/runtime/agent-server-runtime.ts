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

export type AgentServerRuntime = {
  eventBus: TaskEventBus;
  a2aServer: Express;
  start: () => Promise<void>;
  close: () => Promise<void>;
};

export function createAgentServerRuntime(deps: {
  a2a: {
    buildAgentCard: () => AgentCard;
    executeTask: (task: TaskEnvelope, options?: { signal?: AbortSignal }) => Promise<TaskEnvelope>;
    authMiddleware?: RequestHandler;
    userBuilder?: A2AUserBuilder;
    taskStore?: TaskStore;
    eventBus?: TaskEventBus;
  };
  listen: {
    a2a: { port: number; host?: string };
  };
  configureA2A?: (app: Express) => Promise<void> | void;
  createA2AServerApp?: typeof createA2ASdkExpressApp;
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

  const a2aServer = (deps.createA2AServerApp ?? createA2ASdkExpressApp)({
    agentCard: deps.a2a.buildAgentCard(),
    agentExecutor: executor,
    taskStore,
    userBuilder: deps.a2a.userBuilder,
    authMiddleware: deps.a2a.authMiddleware,
  });

  let a2aServerInstance: ReturnType<typeof a2aServer.listen> | null = null;
  let started = false;
  let starting = false;

  async function start(): Promise<void> {
    if (started || starting) {
      throw new Error('Runtime already started');
    }
    starting = true;

    try {
      if (deps.configureA2A) {
        await deps.configureA2A(a2aServer);
      }

      a2aServerInstance = await new Promise((resolve, reject) => {
        const server = a2aServer.listen(deps.listen.a2a.port, deps.listen.a2a.host ?? '0.0.0.0');

        const cleanup = () => {
          server.off('error', onError);
          server.off('listening', onListening);
        };

        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };

        const onListening = () => {
          cleanup();
          resolve(server);
        };

        server.once('error', onError);
        server.once('listening', onListening);
      });
      started = true;
    } catch (error) {
      a2aServerInstance = null;
      throw error;
    } finally {
      starting = false;
    }
  }

  async function close(): Promise<void> {
    if (!a2aServerInstance) {
      started = false;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      a2aServerInstance!.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    a2aServerInstance = null;
    started = false;
  }

  return {
    eventBus,
    a2aServer,
    start,
    close,
  };
}
