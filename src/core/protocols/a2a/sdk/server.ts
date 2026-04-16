import type { AgentCard } from '@a2a-js/sdk';
import {
  type AgentExecutor,
  type TaskStore,
  DefaultRequestHandler,
  InMemoryTaskStore,
} from '@a2a-js/sdk/server';
import {
  agentCardHandler,
  jsonRpcHandler,
  UserBuilder,
  type UserBuilder as A2AUserBuilder,
} from '@a2a-js/sdk/server/express';
import express, { type Express, type RequestHandler } from 'express';

export type CreateA2ASdkExpressAppOptions = {
  agentCard: AgentCard;
  agentExecutor: AgentExecutor;
  taskStore?: TaskStore;
  userBuilder?: A2AUserBuilder;
  authMiddleware?: RequestHandler;
  agentCardPath?: string;
  rpcPath?: string;
};

export function createA2ASdkExpressApp(options: CreateA2ASdkExpressAppOptions): Express {
  const store = options.taskStore ?? new InMemoryTaskStore();
  const requestHandler = new DefaultRequestHandler(options.agentCard, store, options.agentExecutor);
  const userBuilder = options.userBuilder ?? ((_) => UserBuilder.noAuthentication());

  const app = express();
  app.disable('x-powered-by');

  const agentCardPath = options.agentCardPath ?? '/.well-known/agent-card.json';
  app.use(
    agentCardPath,
    agentCardHandler({
      agentCardProvider: () => requestHandler.getAgentCard(),
    }),
  );

  const rpcPath = options.rpcPath ?? '/a2a/jsonrpc';
  const router = express.Router();
  if (options.authMiddleware) {
    router.use(options.authMiddleware);
  }
  router.use(jsonRpcHandler({ requestHandler, userBuilder }));
  app.use(rpcPath, router);

  return app;
}
