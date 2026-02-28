import type { Command } from 'commander';

import { mkdir } from '../../core/adapters/fs/node-fs.js';
import { defaultPathAdapter } from '../../core/adapters/path/path-adapter.js';
import { createSalmonTaskExecutor } from '../../core/backends/salmon-loop/task-executor.js';
import { resolveConfig } from '../../core/config/resolve.js';
import { resolveExtensions } from '../../core/extensions/index.js';
import { logger } from '../../core/observability/logger.js';
import { PluginLoader } from '../../core/plugin/loader.js';
import { buildA2AAgentCard } from '../../core/protocols/a2a/agent-card.js';
import {
  createA2AAuthPolicyMiddleware,
  createAllowAllA2APolicy,
  createBearerTokenAuthenticator,
} from '../../core/protocols/a2a/server/auth-policy.js';
import { createAgentServerRuntime } from '../../core/runtime/agent-server-runtime.js';
import { runSalmonLoop } from '../../core/runtime/loop.js';
import { getSidecarSocketPath } from '../../core/runtime/sidecar-paths.js';
import {
  buildSidecarRouteDescriptors,
  defaultSidecarRouteCatalog,
} from '../../core/runtime/sidecar-route-catalog.js';
import { createTerminalAuthorizationProvider } from '../authorization/provider.js';
import { text } from '../locales/index.js';

import { createRuntimeLlmAndWarn } from './run/runtime-llm.js';

function parsePort(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildSidecarHandlers(deps: {
  name: string;
  version: string;
  capabilities: Array<{ id: string; title: string }>;
}) {
  return {
    health: async () => Response.json({ status: 'ok' }),
    status: async () => Response.json({ state: 'idle' }),
    info: async () =>
      Response.json({
        name: deps.name,
        version: deps.version,
        capabilities: deps.capabilities,
      }),
    abort: async () => new Response('Abort not implemented for this runtime', { status: 501 }),
    workspace_files: async () => new Response('Workspace file access not enabled', { status: 501 }),
    logs_stream: async () => new Response('Log streaming not enabled', { status: 501 }),
    config_patch: async () => new Response('Config patch not enabled', { status: 501 }),
  };
}

export async function handleServeCommand(_options: unknown, command: Command) {
  const allOptions = command.optsWithGlobals();
  const repoPath = defaultPathAdapter.resolve(allOptions.repo || process.cwd());

  const a2aHost = String(allOptions.a2aHost ?? '127.0.0.1');
  const a2aPort = parsePort(allOptions.a2aPort, 7431);
  if (!Number.isFinite(a2aPort) || a2aPort <= 0) {
    logger.error(text.cli.invalidA2APort(String(allOptions.a2aPort ?? '')), true);
    process.exit(1);
  }

  const sidecarSocket =
    typeof allOptions.sidecarSocket === 'string' && allOptions.sidecarSocket.length > 0
      ? allOptions.sidecarSocket
      : getSidecarSocketPath();
  const allowConditional = Boolean(allOptions.sidecarAllowConditional);
  if (!sidecarSocket.startsWith('\\\\.\\pipe\\')) {
    await mkdir(defaultPathAdapter.dirname(sidecarSocket), { recursive: true });
  }

  await PluginLoader.loadPlugins(repoPath);

  const resolvedConfig = await resolveConfig({ repoRoot: repoPath });
  const extensions = await resolveExtensions({ repoRoot: repoPath });

  const { llm } = createRuntimeLlmAndWarn({
    llmConfig: resolvedConfig.llm,
    langfuseEnabled: resolvedConfig.observability.langfuse.enabled,
  });

  const authorizationProvider = createTerminalAuthorizationProvider({
    config: resolvedConfig.toolAuthorization,
    extensions: extensions.resolved,
    forceNonInteractive: true,
  });

  const executor = createSalmonTaskExecutor({
    runLoop: async ({ instruction, mode }) => {
      await runSalmonLoop({
        instruction,
        repoPath,
        llm,
        mode: mode as any,
        verify: resolvedConfig.verify.command,
        strategy: 'worktree',
        applyBackOnDirty: '3way',
        environmentMode: 'strict',
        llmOutput: resolvedConfig.llmOutput,
        authorizationProvider,
        extensions: extensions.resolved,
      });
    },
  });

  const tokens: string[] = Array.isArray(allOptions.a2aToken)
    ? allOptions.a2aToken.filter((token: unknown) => typeof token === 'string')
    : [];
  const authPolicy =
    tokens.length > 0
      ? createA2AAuthPolicyMiddleware({
          authenticator: createBearerTokenAuthenticator({ tokens }),
          policy: createAllowAllA2APolicy(),
        })
      : undefined;

  const capabilities = [{ id: 'patch', title: 'Patch code' }];
  const agentCard = buildA2AAgentCard({
    name: 'salmon-loop',
    url: `http://${a2aHost}:${a2aPort}`,
    capabilities,
    security: tokens.length > 0 ? [{ type: 'http', scheme: 'bearer' }] : [],
  });

  const sidecarRoutes = buildSidecarRouteDescriptors({
    strict: true,
    catalog: defaultSidecarRouteCatalog,
    handlers: buildSidecarHandlers({
      name: 'salmon-loop',
      version: '0.2.0',
      capabilities,
    }),
  });

  const fastify = (await import('fastify')).default;
  const runtime = createAgentServerRuntime({
    createFastify: () => fastify(),
    a2a: {
      buildAgentCard: () => agentCard,
      executeTask: executor.execute,
      authPolicy,
    },
    sidecar: {
      routes: sidecarRoutes,
      allowConditional,
    },
    listen: {
      a2a: { host: a2aHost, port: a2aPort },
      sidecar: { path: sidecarSocket },
    },
    a2aBaseUrl: `http://${a2aHost}:${a2aPort}`,
  });

  await runtime.start();
  logger.success(text.cli.serveStarted(a2aHost, a2aPort, sidecarSocket));
}
