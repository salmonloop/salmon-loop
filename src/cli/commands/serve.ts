import crypto from 'node:crypto';

import type { Command } from 'commander';

import { normalizePermissionMode } from '../../core/config/index.js';
import type { ResolvedConfig } from '../../core/config/types.js';
import {
  buildA2AAgentCard,
  createAcpFormalAgent,
  createAgentServerRuntime,
  createInteractionFacade,
  createSalmonTaskExecutor,
  createTaskEventBus,
  createPluginRegistry,
  createPromptRegistry,
  getUserAcpSessionStorePath,
  GitSnapshotCheckpointService,
  getLogger,
  mergeResolvedExtensions,
  PACKAGE_VERSION,
  PlainReporter,
  PluginLoader,
  resolveExtensions,
  resolveExecutionProfile,
  runSalmonLoop,
  setPluginRegistry,
  setPromptRegistry,
  startAcpStdioServer,
  StderrReporter,
} from '../../core/facades/cli-serve.js';
import { readPlan } from '../../core/plan/index.js';
import { toA2APublicSkills } from '../../core/public-capabilities/projections.js';
import type { CheckpointStrategy } from '../../core/types/loop.js';
import type { ApplyBackOnDirty, FlowMode } from '../../core/types/runtime.js';
import { createTerminalAuthorizationProvider } from '../authorization/provider.js';
import { text } from '../locales/index.js';
import { getOptionValueSourceWithGlobalFallback } from '../utils/command-option-source.js';
import { createOutcomeReporter } from '../utils/outcome-reporter.js';
import { resolveCliConfig } from '../utils/resolve-cli-config.js';

import { createRuntimeLlmAndWarn } from './run/runtime-llm.js';

function parsePort(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function resolveDefaultAcpPermissionPolicy(
  permissionMode: 'interactive' | 'yolo' | undefined,
): 'ask' | 'allow_all' {
  return permissionMode === 'yolo' ? 'allow_all' : 'ask';
}

function resolveServePermissionMode({
  command,
  allOptions,
  rawConfiguredPermissionMode,
  flowMode,
}: {
  command: Command;
  allOptions: Record<string, unknown>;
  rawConfiguredPermissionMode: unknown;
  flowMode: FlowMode;
}): 'interactive' | 'yolo' {
  const permissionModeOptionSource = getOptionValueSourceWithGlobalFallback(command, 'mode');
  const configuredPermissionMode = normalizePermissionMode(rawConfiguredPermissionMode);
  const rawPermissionMode =
    (permissionModeOptionSource === 'cli' ? allOptions.mode : undefined) ??
    configuredPermissionMode ??
    resolveExecutionProfile(flowMode).defaultPermissionMode ??
    'interactive';
  const permissionMode = normalizePermissionMode(rawPermissionMode);
  if (!permissionMode) {
    getLogger().error(
      `Invalid --mode "${String(rawPermissionMode)}". Expected "interactive" or "yolo".`,
      true,
    );
    process.exit(1);
  }
  return permissionMode;
}

function buildServeLoopExecutionDefaults(mode: FlowMode): {
  strategy: CheckpointStrategy;
  applyBackOnDirty?: ApplyBackOnDirty;
  environmentMode: 'strict';
} {
  const profile = resolveExecutionProfile(mode);
  const strategy = profile.defaultCheckpointStrategy ?? 'worktree';
  return {
    strategy,
    applyBackOnDirty: strategy === 'worktree' ? '3way' : undefined,
    environmentMode: 'strict' as const,
  };
}

function registerServeShutdown({
  message,
  closeRuntime,
  closeAcpStdio,
}: {
  message: string;
  closeRuntime?: () => Promise<void>;
  closeAcpStdio?: () => void;
}) {
  const shutdown = async () => {
    getLogger().info(message);
    try {
      await closeRuntime?.();
    } finally {
      closeAcpStdio?.();
      process.exit(0);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

async function resolveServeCommonSetup(params: {
  command: Command;
  allOptions: Record<string, unknown>;
  defaultRepoPath: string;
  resolvedConfig: ResolvedConfig;
  auditScope: 'repo' | 'user' | undefined;
}) {
  const { command, allOptions, defaultRepoPath, resolvedConfig, auditScope } = params;
  const defaultFlowMode: FlowMode = 'autopilot';
  const defaultPermissionMode = resolveServePermissionMode({
    command,
    allOptions,
    rawConfiguredPermissionMode: resolvedConfig.raw?.mode,
    flowMode: defaultFlowMode,
  });

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
      extensions: taskExtensions,
    }) => {
      const effectiveRepoPath = repoPath ?? defaultRepoPath;
      const flowMode = mode as FlowMode;
      const executionDefaults = buildServeLoopExecutionDefaults(flowMode);
      const permissionMode = resolveServePermissionMode({
        command,
        allOptions,
        rawConfiguredPermissionMode: resolvedConfig.raw?.mode,
        flowMode,
      });
      return await runSalmonLoop({
        instruction,
        repoPath: effectiveRepoPath,
        llm,
        mode: flowMode,
        verify: resolvedConfig.verify.command,
        ...executionDefaults,
        llmOutput: resolvedConfig.llmOutput,
        outcomeReporter,
        langfuseSessionId: resolvedConfig.observability.langfuse.sessionId,
        langfuseUserId: resolvedConfig.observability.langfuse.userId,
        auditScope,
        permissionMode,
        languagePlugins,
        fileSystemOverride,
        authorizationProvider: authorizationProvider ?? defaultAuthorizationProvider,
        authorizationMode,
        extensions: mergeResolvedExtensions(extensions.resolved, taskExtensions),
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

  return {
    defaultPermissionMode,
    executor,
    sharedEventBus,
    checkpointService,
    acpFacade,
  };
}

function buildAcpAgentOptions(params: {
  facade: ReturnType<typeof createInteractionFacade>;
  checkpointService: GitSnapshotCheckpointService;
  defaultPermissionMode: 'interactive' | 'yolo';
  sharedEventBus: ReturnType<typeof createTaskEventBus>;
  sessionStorePolicy: Record<string, unknown> | undefined;
}) {
  return {
    agentInfo: { name: 'salmon-loop', version: PACKAGE_VERSION },
    defaultModeId: 'autopilot' as const,
    defaultPermissionPolicy: resolveDefaultAcpPermissionPolicy(params.defaultPermissionMode),
    checkpointReader: {
      listBySession: async ({
        repoPath,
        sessionId,
        limit,
      }: {
        repoPath: string;
        sessionId: string;
        limit?: number;
      }) => await params.checkpointService.list({ repoPath, sessionId, limit }),
      getById: async ({ repoPath, checkpointId }: { repoPath: string; checkpointId: string }) =>
        (await params.checkpointService.loadWithStatus({ repoPath, checkpointId })).handle,
      probeById: async ({ repoPath, checkpointId }: { repoPath: string; checkpointId: string }) => {
        const status = await params.checkpointService.loadWithStatus({ repoPath, checkpointId });
        return { valid: Boolean(status.handle), reason: status.reason };
      },
    },
    planReader: {
      readBySession: async ({ repoPath, sessionId }: { repoPath: string; sessionId: string }) =>
        await readPlan({ persistenceRoot: repoPath, sessionId }),
    },
    facade: params.facade,
    sessionPersistencePath: getUserAcpSessionStorePath(),
    sessionStorePolicy: params.sessionStorePolicy,
    eventBus: params.sharedEventBus,
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
  const configResult = await resolveCliConfig({
    repo: allOptions.repo,
    cwd: process.cwd(),
    configPath: allOptions.config,
    enableConfigFile: allOptions.configFile !== false,
    auditScope: allOptions.auditScope,
    logMode: allOptions.logMode,
  });
  if (!configResult.ok) {
    getLogger().error(configResult.message, true);
    process.exit(1);
  }
  const { resolvedConfig, repoPath: defaultRepoPath } = configResult;
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

  const { defaultPermissionMode, executor, sharedEventBus, checkpointService, acpFacade } =
    await resolveServeCommonSetup({
      command,
      allOptions,
      defaultRepoPath,
      resolvedConfig,
      auditScope: configResult.auditScope,
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

          let isAuthenticated = false;
          if (scheme?.toLowerCase() === 'bearer' && token) {
            const tokenBuffer = Buffer.from(token);
            for (const authToken of authTokens) {
              const authTokenBuffer = Buffer.from(authToken);
              if (
                tokenBuffer.length === authTokenBuffer.length &&
                crypto.timingSafeEqual(tokenBuffer, authTokenBuffer)
              ) {
                isAuthenticated = true;
                break;
              }
            }
          }

          if (!isAuthenticated) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
          }
          next();
        }
      : undefined;

  const a2aSkills = toA2APublicSkills();
  const agentCard = buildA2AAgentCard({
    name: 'salmon-loop',
    url: `http://${a2aHost}:${a2aPort}/a2a/jsonrpc`,
    capabilities: a2aSkills,
    security: authTokens.length > 0 ? [{ type: 'http', scheme: 'bearer' }] : [],
  });

  if (acpStdioEnabled) {
    const agentOptions = buildAcpAgentOptions({
      facade: acpFacade,
      checkpointService,
      defaultPermissionMode,
      sharedEventBus,
      sessionStorePolicy: resolvedConfig.server?.acp?.sessionStore,
    });
    startAcpStdioServer((conn) => createAcpFormalAgent({ conn, ...agentOptions }));
    getLogger().info(text.cli.acpStdioStarted('n/a (stdio)'));
  }

  const runtime = createAgentServerRuntime({
    a2a: {
      buildAgentCard: () => agentCard,
      executeTask: executor.execute,
      eventBus: sharedEventBus,
      authMiddleware,
    },
    listen: {
      a2a: { host: a2aHost, port: a2aPort },
    },
  });

  registerServeShutdown({
    message: 'Received SIGINT, shutting down server...',
    closeRuntime: () => runtime.close(),
    closeAcpStdio: acpStdioEnabled ? () => void process.stdin.destroy() : undefined,
  });

  await runtime.start();
  getLogger().success(text.cli.serveStarted(a2aHost, a2aPort));
}

export async function handleServeAcpCommand(_options: unknown, command: Command) {
  const allOptions = command.optsWithGlobals();
  const configResult = await resolveCliConfig({
    repo: allOptions.repo,
    cwd: process.cwd(),
    configPath: allOptions.config,
    enableConfigFile: allOptions.configFile !== false,
    auditScope: allOptions.auditScope,
    logMode: allOptions.logMode,
  });
  if (!configResult.ok) {
    getLogger().error(configResult.message, true);
    process.exit(1);
  }
  const { resolvedConfig, repoPath: defaultRepoPath } = configResult;

  getLogger().setReporter(allOptions.color === false ? new StderrReporter() : new PlainReporter());

  const { defaultPermissionMode, acpFacade, checkpointService, sharedEventBus } =
    await resolveServeCommonSetup({
      command,
      allOptions,
      defaultRepoPath,
      resolvedConfig,
      auditScope: configResult.auditScope,
    });

  const agentOptions = buildAcpAgentOptions({
    facade: acpFacade,
    checkpointService,
    defaultPermissionMode,
    sharedEventBus,
    sessionStorePolicy: resolvedConfig.server?.acp?.sessionStore,
  });
  startAcpStdioServer((conn) => createAcpFormalAgent({ conn, ...agentOptions }));

  getLogger().info(text.cli.acpStdioStarted('n/a (stdio)'));
  registerServeShutdown({
    message: 'Received SIGINT, shutting down ACP server...',
    closeAcpStdio: () => void process.stdin.destroy(),
  });
}
