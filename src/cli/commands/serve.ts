import type { Command } from 'commander';

import {
  buildA2AAgentCard,
  buildSidecarRouteDescriptors,
  createAcpFormalAgent,
  createAgentServerRuntime,
  createInteractionFacade,
  createSalmonTaskExecutor,
  createTaskEventBus,
  createPluginRegistry,
  createPromptRegistry,
  defaultSidecarRouteCatalog,
  defaultPathAdapter,
  getSidecarListenOptions,
  getUserAcpSessionStorePath,
  GitSnapshotCheckpointService,
  getLogger,
  mkdir,
  PlainReporter,
  PluginLoader,
  resolveExtensions,
  runSalmonLoop,
  setPluginRegistry,
  setPromptRegistry,
  startAcpStdioServer,
  StderrReporter,
} from '../../core/facades/cli-serve.js';
import { createTerminalAuthorizationProvider } from '../authorization/provider.js';
import { text } from '../locales/index.js';
import { createOutcomeReporter } from '../utils/outcome-reporter.js';
import { resolveCliConfig } from '../utils/resolve-cli-config.js';

import { createRuntimeLlmAndWarn } from './run/runtime-llm.js';

function parsePort(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
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

export function registerServeCommands(program: Command) {
  const serve = program
    .command('serve')
    .description(text.cli.serveDescription)
    .option('--a2a-host <host>', text.cli.a2aHostOption)
    .option('--a2a-port <port>', text.cli.a2aPortOption)
    .option(
      '--a2a-token <token>',
      text.cli.a2aTokenOption,
      (value, previous: string[]) => previous.concat([value]),
      [] as string[],
    )
    .option('--no-acp-stdio', text.cli.acpStdioDisableOption)
    .option('--sidecar-socket <path>', text.cli.sidecarSocketOption)
    .option('--sidecar-allow-conditional', text.cli.sidecarAllowConditionalOption)
    .option('--no-color', text.cli.noColorOption)
    .action(handleServeCommand);

  serve
    .command('acp')
    .description(text.cli.serveAcpDescription)
    .option('--no-color', text.cli.noColorOption)
    .action(handleServeAcpCommand);
}

export async function handleServeCommand(_options: unknown, command: Command) {
  const allOptions = command.optsWithGlobals();
  const defaultRepoPath = defaultPathAdapter.resolve(allOptions.repo || process.cwd());

  const configResult = await resolveCliConfig({
    repoPath: defaultRepoPath,
    configPath: allOptions.config,
    enableConfigFile: allOptions.configFile !== false,
    auditScope: allOptions.auditScope,
  });
  if (!configResult.ok) {
    getLogger().error(configResult.message, true);
    process.exit(1);
  }
  const { resolvedConfig, auditScope } = configResult;
  const serverConfig = resolvedConfig.server;
  const rawA2aHost = allOptions.a2aHost ?? serverConfig?.a2a?.host;
  const a2aHost = String(rawA2aHost ?? '127.0.0.1');
  const rawA2aPort = allOptions.a2aPort ?? serverConfig?.a2a?.port;
  const a2aPort = parsePort(rawA2aPort, 7431);
  if (!Number.isFinite(a2aPort) || a2aPort <= 0) {
    getLogger().error(text.cli.invalidA2APort(String(rawA2aPort ?? '')), true);
    process.exit(1);
  }
  const acpStdioEnabled = allOptions.acpStdio !== false;
  if (acpStdioEnabled) {
    getLogger().setReporter(
      allOptions.color === false ? new StderrReporter() : new PlainReporter(),
    );
  }

  const sidecarListen =
    typeof allOptions.sidecarSocket === 'string' && allOptions.sidecarSocket.length > 0
      ? { type: 'pipe' as const, path: allOptions.sidecarSocket }
      : getSidecarListenOptions();
  const allowConditional =
    allOptions.sidecarAllowConditional ?? serverConfig?.sidecar?.allowConditional ?? false;
  if (sidecarListen.type === 'pipe' && !sidecarListen.path.startsWith('\\\\.\\pipe\\')) {
    await mkdir(defaultPathAdapter.dirname(sidecarListen.path), { recursive: true });
  }

  const languagePlugins = createPluginRegistry();
  setPluginRegistry(languagePlugins);
  setPromptRegistry(createPromptRegistry());
  await PluginLoader.loadPlugins(languagePlugins, defaultRepoPath);
  const extensions = await resolveExtensions({ repoRoot: defaultRepoPath });

  const { llm } = createRuntimeLlmAndWarn({
    llmConfig: resolvedConfig.llm,
    langfuseEnabled: resolvedConfig.observability.langfuse.enabled,
  });

  const outcomeReporter = createOutcomeReporter({
    enabled: resolvedConfig.observability.langfuse.outcome,
    endpoint: resolvedConfig.observability.langfuse.endpoint,
    llmBaseUrl: resolvedConfig.llm.api.baseUrl,
    langfuseApiKey: resolvedConfig.observability.langfuse.apiKey,
  });

  const defaultAuthorizationProvider = createTerminalAuthorizationProvider({
    config: resolvedConfig.toolAuthorization,
    extensions: extensions.resolved,
    forceNonInteractive: true,
  });

  const executor = createSalmonTaskExecutor({
    runLoop: async ({
      instruction,
      mode,
      repoPath,
      onEvent,
      signal,
      authorizationProvider,
      authorizationMode,
      fileSystemOverride,
    }) => {
      const effectiveRepoPath = repoPath ?? defaultRepoPath;
      return await runSalmonLoop({
        instruction,
        repoPath: effectiveRepoPath,
        llm,
        mode: mode as any,
        verify: resolvedConfig.verify.command,
        strategy: 'worktree',
        applyBackOnDirty: '3way',
        environmentMode: 'strict',
        llmOutput: resolvedConfig.llmOutput,
        outcomeReporter,
        langfuseSessionId: resolvedConfig.observability.langfuse.sessionId,
        langfuseUserId: resolvedConfig.observability.langfuse.userId,
        auditScope,
        permissionMode: resolvedConfig.permissionMode,
        languagePlugins,
        fileSystemOverride,
        authorizationProvider: authorizationProvider ?? defaultAuthorizationProvider,
        authorizationMode,
        extensions: extensions.resolved,
        onEvent,
        signal,
      });
    },
  });

  const sharedEventBus = createTaskEventBus();
  const checkpointService = new GitSnapshotCheckpointService(
    undefined,
    resolvedConfig.server?.acp?.checkpointManifest,
  );
  await checkpointService.gc({
    repoPath: defaultRepoPath,
    olderThanMs: 1000 * 60 * 60 * 24 * 14,
    maxPerSession: 30,
  });
  const acpFacade = createInteractionFacade({
    executeTask: executor.execute,
    eventBus: sharedEventBus,
  });

  const tokens: string[] = Array.isArray(allOptions.a2aToken)
    ? allOptions.a2aToken.filter((token: unknown) => typeof token === 'string')
    : [];
  const authTokens = tokens.length > 0 ? tokens : (serverConfig?.a2a?.tokens ?? []);

  // Create Express middleware for authentication
  const authMiddleware =
    authTokens.length > 0
      ? (req: any, res: any, next: any) => {
          const authHeader = req.headers.authorization;
          if (!authHeader) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
          }
          const [scheme, token] = authHeader.split(' ');
          if (scheme?.toLowerCase() !== 'bearer' || !authTokens.includes(token)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
          }
          next();
        }
      : undefined;

  const capabilities = [{ id: 'patch', title: 'Patch code' }];
  const agentCard = buildA2AAgentCard({
    name: 'salmon-loop',
    url: `http://${a2aHost}:${a2aPort}`,
    capabilities,
    security: authTokens.length > 0 ? [{ type: 'http', scheme: 'bearer' }] : [],
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

  if (acpStdioEnabled) {
    startAcpStdioServer((conn) =>
      createAcpFormalAgent({
        conn,
        agentInfo: { name: 'salmon-loop', version: '0.2.0' },
        defaultModeId: resolvedConfig.permissionMode,
        checkpointReader: {
          listBySession: async ({ repoPath, sessionId, limit }) =>
            await checkpointService.list({ repoPath, sessionId, limit }),
          getById: async ({ repoPath, checkpointId }) =>
            (await checkpointService.loadWithStatus({ repoPath, checkpointId })).handle,
          probeById: async ({ repoPath, checkpointId }) => {
            const status = await checkpointService.loadWithStatus({ repoPath, checkpointId });
            return { valid: Boolean(status.handle), reason: status.reason };
          },
        },
        facade: acpFacade,
        sessionPersistencePath: getUserAcpSessionStorePath(),
        sessionStorePolicy: resolvedConfig.server?.acp?.sessionStore,
        eventBus: sharedEventBus,
      }),
    );
    getLogger().info(text.cli.acpStdioStarted('n/a (stdio)'));

    // Handle SIGINT for graceful shutdown
    process.on('SIGINT', () => {
      getLogger().info('Received SIGINT, shutting down ACP server...');
      process.stdin.destroy();
      process.exit(0);
    });
  }

  const fastify = (await import('fastify')).default;
  const runtime = createAgentServerRuntime({
    createFastify: () => fastify(),
    a2a: {
      buildAgentCard: () => agentCard,
      executeTask: executor.execute,
      eventBus: sharedEventBus,
      authMiddleware,
    },
    sidecar: {
      routes: sidecarRoutes,
      allowConditional,
    },
    listen: {
      a2a: { host: a2aHost, port: a2aPort },
      sidecar: sidecarListen,
    },
    a2aBaseUrl: `http://${a2aHost}:${a2aPort}`,
  });

  // Handle SIGINT for graceful shutdown
  process.on('SIGINT', () => {
    getLogger().info('Received SIGINT, shutting down server...');
    runtime.close().then(() => process.exit(0));
  });

  await runtime.start();
  const sidecarAddress =
    sidecarListen.type === 'tcp'
      ? `http://${sidecarListen.host}:${sidecarListen.port}`
      : sidecarListen.path;
  getLogger().success(text.cli.serveStarted(a2aHost, a2aPort, sidecarAddress));
}

export async function handleServeAcpCommand(_options: unknown, command: Command) {
  const allOptions = command.optsWithGlobals();
  const defaultRepoPath = defaultPathAdapter.resolve(allOptions.repo || process.cwd());

  const configResult = await resolveCliConfig({
    repoPath: defaultRepoPath,
    configPath: allOptions.config,
    enableConfigFile: allOptions.configFile !== false,
    auditScope: allOptions.auditScope,
  });
  if (!configResult.ok) {
    getLogger().error(configResult.message, true);
    process.exit(1);
  }
  const { resolvedConfig, auditScope } = configResult;

  getLogger().setReporter(allOptions.color === false ? new StderrReporter() : new PlainReporter());

  const languagePlugins = createPluginRegistry();
  setPluginRegistry(languagePlugins);
  setPromptRegistry(createPromptRegistry());
  await PluginLoader.loadPlugins(languagePlugins, defaultRepoPath);
  const extensions = await resolveExtensions({ repoRoot: defaultRepoPath });

  const { llm } = createRuntimeLlmAndWarn({
    llmConfig: resolvedConfig.llm,
    langfuseEnabled: resolvedConfig.observability.langfuse.enabled,
  });

  const outcomeReporter = createOutcomeReporter({
    enabled: resolvedConfig.observability.langfuse.outcome,
    endpoint: resolvedConfig.observability.langfuse.endpoint,
    llmBaseUrl: resolvedConfig.llm.api.baseUrl,
    langfuseApiKey: resolvedConfig.observability.langfuse.apiKey,
  });

  const defaultAuthorizationProvider = createTerminalAuthorizationProvider({
    config: resolvedConfig.toolAuthorization,
    extensions: extensions.resolved,
    forceNonInteractive: true,
  });

  const executor = createSalmonTaskExecutor({
    runLoop: async ({
      instruction,
      mode,
      repoPath,
      onEvent,
      signal,
      authorizationProvider,
      authorizationMode,
    }) => {
      const effectiveRepoPath = repoPath ?? defaultRepoPath;
      return await runSalmonLoop({
        instruction,
        repoPath: effectiveRepoPath,
        llm,
        mode: mode as any,
        verify: resolvedConfig.verify.command,
        strategy: 'worktree',
        applyBackOnDirty: '3way',
        environmentMode: 'strict',
        llmOutput: resolvedConfig.llmOutput,
        outcomeReporter,
        langfuseSessionId: resolvedConfig.observability.langfuse.sessionId,
        langfuseUserId: resolvedConfig.observability.langfuse.userId,
        auditScope,
        permissionMode: resolvedConfig.permissionMode,
        languagePlugins,
        authorizationProvider: authorizationProvider ?? defaultAuthorizationProvider,
        authorizationMode,
        extensions: extensions.resolved,
        onEvent,
        signal,
      });
    },
  });

  const sharedEventBus = createTaskEventBus();
  const checkpointService = new GitSnapshotCheckpointService(
    undefined,
    resolvedConfig.server?.acp?.checkpointManifest,
  );
  await checkpointService.gc({
    repoPath: defaultRepoPath,
    olderThanMs: 1000 * 60 * 60 * 24 * 14,
    maxPerSession: 30,
  });
  const acpFacade = createInteractionFacade({
    executeTask: executor.execute,
    eventBus: sharedEventBus,
  });

  startAcpStdioServer((conn) =>
    createAcpFormalAgent({
      conn,
      agentInfo: { name: 'salmon-loop', version: '0.2.0' },
      defaultModeId: resolvedConfig.permissionMode,
      checkpointReader: {
        listBySession: async ({ repoPath, sessionId, limit }) =>
          await checkpointService.list({ repoPath, sessionId, limit }),
        getById: async ({ repoPath, checkpointId }) =>
          (await checkpointService.loadWithStatus({ repoPath, checkpointId })).handle,
        probeById: async ({ repoPath, checkpointId }) => {
          const status = await checkpointService.loadWithStatus({ repoPath, checkpointId });
          return { valid: Boolean(status.handle), reason: status.reason };
        },
      },
      facade: acpFacade,
      sessionPersistencePath: getUserAcpSessionStorePath(),
      sessionStorePolicy: resolvedConfig.server?.acp?.sessionStore,
      eventBus: sharedEventBus,
    }),
  );

  getLogger().info(text.cli.acpStdioStarted('n/a (stdio)'));

  process.on('SIGINT', () => {
    getLogger().info('Received SIGINT, shutting down ACP server...');
    process.stdin.destroy();
    process.exit(0);
  });
}
