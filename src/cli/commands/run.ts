import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { resolve } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';

import { redactConfigForPrint, resolveConfig, ConfigError } from '../../core/config/index.js';
import { resolveExtensions, ExtensionConfigError } from '../../core/extensions/index.js';
import type { ExtensionResolution } from '../../core/extensions/index.js';
import { createRuntimeLlm } from '../../core/llm/factory.js';
import { emitLlmOutput } from '../../core/llm/output-policy.js';
import { logger } from '../../core/observability/logger.js';
import { PluginLoader } from '../../core/plugin/loader.js';
import { runSalmonLoop } from '../../core/runtime/loop.js';
import { ChatSessionManager } from '../../core/session/manager.js';
import {
  VerboseLevel,
  CheckpointStrategy,
  ApplyBackOnDirty,
  LoopResult,
  type FlowMode,
} from '../../core/types/index.js';
import { LiteLlmLangfuseOutcomeReporter } from '../../integrations/langfuse/litellm-langfuse-outcome-reporter.js';
import { resolveLangfuseOutcomeProxyBaseUrl } from '../../integrations/langfuse/outcome-proxy.js';
import {
  createTerminalAuthorizationProvider,
  createUiAuthorizationProvider,
} from '../authorization/provider.js';
import { text } from '../locales/index.js';
import { SalmonReporter } from '../reporters/base.js';
import { JsonReporter } from '../reporters/json.js';
import { StandardReporter } from '../reporters/standard.js';
import { StderrLogReporter } from '../reporters/stderr-log-reporter.js';
import { StreamJsonReporter } from '../reporters/stream-json.js';
import { resolveLlmOutputPolicyFromCli } from '../utils/llm-output.js';
import { resolveVerifyOption } from '../utils/verify-resolver.js';

export async function handleRunCommand(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const continueSession = Boolean((allOptions as any).continue);
  const resumeSessionId =
    typeof (allOptions as any).resume === 'string'
      ? ((allOptions as any).resume as string)
      : undefined;

  const rawOutputFormat = String(allOptions.outputFormat || 'text');
  if (
    rawOutputFormat !== 'text' &&
    rawOutputFormat !== 'stream-json' &&
    rawOutputFormat !== 'json'
  ) {
    logger.error(text.cli.invalidOutputFormat(rawOutputFormat), true);
    process.exit(1);
  }
  const outputFormat = rawOutputFormat as 'text' | 'stream-json' | 'json';
  const headlessOutput = outputFormat !== 'text';
  const useGui = !headlessOutput && allOptions.gui !== false && process.stdout.isTTY;

  if (headlessOutput) {
    // Ensure stdout is reserved for machine-readable output.
    logger.setReporter(new StderrLogReporter());
  }

  if (continueSession && resumeSessionId) {
    logger.error(text.cli.continueResumeConflict, true);
    process.exit(1);
  }

  const wantSessionPersistence =
    !allOptions.printConfig &&
    (headlessOutput ||
      continueSession ||
      Boolean(resumeSessionId) ||
      typeof allOptions.instruction === 'string');

  const sessionManager = wantSessionPersistence ? new ChatSessionManager(runPath) : undefined;
  let sessionIdForOutput: string | undefined;

  const writeStreamJsonEarlyError = (params: {
    sessionId: string;
    message: string;
    exitCode?: number;
  }) => {
    const now = new Date().toISOString();
    process.stdout.write(
      JSON.stringify({
        type: 'error',
        session_id: params.sessionId,
        timestamp: now,
        error: { message: params.message },
      }) + '\n',
    );
    process.stdout.write(
      JSON.stringify({
        type: 'end',
        session_id: params.sessionId,
        timestamp: now,
        success: false,
        exit_code: params.exitCode ?? 1,
      }) + '\n',
    );
  };

  if (sessionManager) {
    await sessionManager.init();
    try {
      if (resumeSessionId) {
        await sessionManager.resumeSession(resumeSessionId);
      } else if (continueSession) {
        const resumed = await sessionManager.loadLast();
        if (!resumed) {
          await sessionManager.create();
        }
      } else {
        await sessionManager.create();
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      if (resumeSessionId && outputFormat === 'json') {
        process.stdout.write(
          JSON.stringify({
            result: '',
            structured_output: null,
            session_id: resumeSessionId,
            metadata: {
              command: 'run',
              repo_path: runPath,
              success: false,
              exit_code: 1,
              reason: msg,
              timestamps: { ended_at: new Date().toISOString() },
            },
          }) + '\n',
        );
      } else if (resumeSessionId && outputFormat === 'stream-json') {
        writeStreamJsonEarlyError({ sessionId: resumeSessionId, message: msg });
      } else {
        logger.error(msg, true);
      }
      process.exit(1);
    }

    sessionIdForOutput = sessionManager.getCurrent().meta.id;
  }

  const writeJsonOutput = (payload: unknown) => {
    process.stdout.write(JSON.stringify(payload) + '\n');
  };

  const writeJsonFailure = (params: {
    exitCode?: number;
    message: string;
    errorCode?: string;
    repoPath?: string;
    instruction?: string;
  }) => {
    const exitCode = params.exitCode ?? 1;
    writeJsonOutput({
      result: '',
      structured_output: null,
      session_id: sessionIdForOutput ?? randomUUID(),
      metadata: {
        command: 'run',
        repo_path: params.repoPath ?? runPath,
        instruction: params.instruction,
        success: false,
        exit_code: exitCode,
        reason: params.message,
        error_code: params.errorCode,
        timestamps: {
          ended_at: new Date().toISOString(),
        },
      },
    });
  };

  const resolveExitCode = (result: LoopResult): number => {
    if (result.reason === 'Operation cancelled by user') return 130;
    return result.success ? 0 : 1;
  };

  const splitToolRules = (raw: unknown): string[] => {
    const parts: string[] = [];
    const push = (s: unknown) => {
      if (typeof s !== 'string') return;
      for (const piece of s.split(',')) {
        const trimmed = piece.trim();
        if (trimmed) parts.push(trimmed);
      }
    };
    if (Array.isArray(raw)) {
      for (const v of raw) push(v);
      return parts;
    }
    push(raw);
    return parts;
  };

  const allowedToolRules = splitToolRules(allOptions.allowedTools);
  const disallowedToolRules = splitToolRules(allOptions.disallowedTools);

  const runValidateCommand = (cmd: string, args: string[]) => {
    const result = spawnSync(cmd, args, {
      cwd: runPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      maxBuffer: 500_000,
    });

    const stdout = (result.stdout || '').trim();
    const stderr = (result.stderr || '').trim();
    const combined = [stdout, stderr].filter(Boolean).join('\n').trim();

    if (combined) {
      // Avoid dumping huge output in GUI sessions (even before Ink starts).
      const output = useGui ? combined.slice(0, 2_000) : combined;
      logger.log(output);
    }

    if (result.error) {
      throw result.error;
    }

    if (typeof result.status === 'number' && result.status !== 0) {
      throw new Error(`Command failed with exit code ${result.status}`);
    }
  };

  // Initialize plugins (including user plugins from .salmonloop/languages)
  await PluginLoader.loadPlugins(runPath);

  if (allOptions.validate) {
    logger.log(chalk.blue(text.cli.runningValidation));
    try {
      logger.debug(text.cli.runningEslint);
      runValidateCommand('npx', ['eslint', 'src', '--ext', '.ts']);
      logger.debug(text.cli.runningTests);
      try {
        runValidateCommand('npm', ['test']);
      } catch (__e) {
        logger.warn(text.cli.testsFailedContinuing);
      }
      logger.success(text.cli.validationCompleted);
    } catch (__e) {
      logger.error(text.cli.validationFailed, true);
    }
    if (!options.instruction) {
      return;
    }
  }

  let resolvedConfig: Awaited<ReturnType<typeof resolveConfig>>;
  try {
    resolvedConfig = await resolveConfig({
      repoRoot: runPath,
      configFilePath: allOptions.config,
      enableConfigFile: allOptions.configFile !== false,
    });
  } catch (err: any) {
    if (err instanceof ConfigError) {
      const msg = text.config.error(err.code || err.message, err.details);
      logger.error(msg, true);
      if (outputFormat === 'json') {
        writeJsonFailure({ message: msg, errorCode: err.code, repoPath: runPath });
        process.exitCode = 1;
        return;
      }
      process.exitCode = 1;
      return;
    }

    const msg = err instanceof Error ? err.message : String(err);
    logger.error(text.config.loadFailed(msg), true);
    if (outputFormat === 'json') {
      writeJsonFailure({ message: text.config.loadFailed(msg), repoPath: runPath });
      process.exitCode = 1;
      return;
    }
    process.exitCode = 1;
    return;
  }

  if (allOptions.printConfig) {
    const raw = resolvedConfig.raw || { version: 1 };
    const redacted = redactConfigForPrint(raw);
    process.stdout.write(JSON.stringify(redacted, null, 2) + '\n');
    return;
  }

  const llmOutputResolution = resolveLlmOutputPolicyFromCli(
    resolvedConfig.llmOutput,
    allOptions.llmOutput,
  );
  if (!llmOutputResolution.ok) {
    logger.error(text.cli.invalidLlmOutputKind(llmOutputResolution.invalid), true);
    if (outputFormat === 'json') {
      writeJsonFailure({
        message: text.cli.invalidLlmOutputKind(llmOutputResolution.invalid),
        repoPath: runPath,
      });
      process.exitCode = 1;
      return;
    }
    process.exitCode = 1;
    return;
  }
  const llmOutput = {
    ...llmOutputResolution.policy,
    kinds: [...llmOutputResolution.policy.kinds],
  };

  // Smart verification resolution with auto-detection
  const effectiveVerify = await resolveVerifyOption(
    runPath,
    allOptions.verify,
    resolvedConfig.verify.command,
  );

  if (!allOptions.instruction) {
    if (!allOptions.validate) {
      logger.error(text.cli.optionsRequired);
      if (outputFormat === 'text') {
        command.help(); // Show help if required options are missing
      }
      if (outputFormat === 'json') {
        writeJsonFailure({ message: text.cli.optionsRequired, repoPath: runPath });
      }
      process.exit(1);
    }
    return;
  }

  const rawMode = String(allOptions.mode || 'patch');
  if (rawMode !== 'patch' && rawMode !== 'review' && rawMode !== 'debug') {
    logger.error(text.cli.invalidMode(rawMode), true);
    if (outputFormat === 'json') {
      writeJsonFailure({ message: text.cli.invalidMode(rawMode), repoPath: runPath });
    }
    process.exit(1);
  }
  const mode = rawMode as FlowMode;

  let extensionResolution: ExtensionResolution | undefined;
  try {
    extensionResolution = await resolveExtensions({ repoRoot: runPath });
  } catch (err: any) {
    if (err instanceof ExtensionConfigError) {
      logger.error(`Extension configuration invalid: ${err.message}`, true);
      if (outputFormat === 'json') {
        writeJsonFailure({
          message: `Extension configuration invalid: ${err.message}`,
          repoPath: runPath,
        });
      }
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  // Verification is now optional - warn if not found
  if (!effectiveVerify) {
    logger.warn(text.verify.noCommandFound);
  }

  const verboseLevel =
    allOptions.verbose === true ? 'basic' : (allOptions.verbose as VerboseLevel | undefined);

  if (verboseLevel) {
    logger.setVerbose(verboseLevel);
    logger.cyan(text.cli.runningWith);
    logger.log(text.cli.instruction(allOptions.instruction));
    if (effectiveVerify) {
      logger.log(text.cli.verify(effectiveVerify));
    }
    logger.log(text.cli.repoPath(runPath));
    if (allOptions.file) logger.log(text.cli.contextFile(allOptions.file));
    if (allOptions.selection) logger.log(text.cli.contextSelection(allOptions.selection.length));
    if (allowedToolRules.length > 0) {
      logger.log(text.cli.allowedTools(allowedToolRules.join(', ')));
    }
    if (disallowedToolRules.length > 0) {
      logger.log(text.cli.disallowedTools(disallowedToolRules.join(', ')));
    }
    if (allOptions.dryRun) logger.warn(text.cli.dryRunEnabled);
    if (resolvedConfig.source.used) {
      logger.log(text.cli.configPath(resolvedConfig.source.path || ''));
    }
  }

  try {
    const llmType = resolvedConfig.llm.type;
    const clientPackage = resolvedConfig.llm.clientPackage;

    const runtimeLlm = createRuntimeLlm(resolvedConfig.llm, {
      langfuseEnabled: resolvedConfig.observability.langfuse.enabled,
    });
    const llm = runtimeLlm.llm;

    for (const w of runtimeLlm.warnings) {
      if (w === 'API_KEY_MISSING') {
        logger.warn(text.cli.apiKeyMissing);
      } else if (w === 'PROVIDER_NOT_SUPPORTED') {
        logger.warn(text.cli.providerNotSupported(llmType));
      } else if (w === 'CLIENT_PACKAGE_NOT_SUPPORTED') {
        logger.warn(text.cli.clientPackageNotSupported(clientPackage || ''));
      }
    }

    // Initialize Reporter (Adapter Pattern)
    // NOTE: In GUI mode we must avoid writing to stdout/stderr outside Ink.
    const reporter: SalmonReporter = useGui
      ? {
          onStart: () => {},
          onEvent: () => {},
          onFinish: () => {},
          onError: () => {},
        }
      : outputFormat === 'stream-json'
        ? new StreamJsonReporter({ mode: 'run', repoPath: runPath, sessionId: sessionIdForOutput })
        : outputFormat === 'json'
          ? new JsonReporter({ mode: 'run', repoPath: runPath, sessionId: sessionIdForOutput })
          : new StandardReporter(Boolean(allOptions.verbose));

    reporter.onStart(allOptions.instruction);

    const applyBackOnDirty = allOptions.applyBackOnDirty === 'abort' ? 'abort' : '3way';

    if (allOptions.streamOutput && !llmOutput.kinds.includes('plan')) {
      llmOutput.kinds.push('plan');
    }

    const outcomeReporter = (() => {
      const resolved = resolveLangfuseOutcomeProxyBaseUrl({
        enabled: resolvedConfig.observability.langfuse.outcome,
        endpoint: resolvedConfig.observability.langfuse.endpoint,
        llmBaseUrl: resolvedConfig.llm.api.baseUrl,
      });
      if (!resolved.enabled || !resolved.proxyBaseUrl) return undefined;
      const proxyApiKey =
        (process.env.SALMONLOOP_LANGFUSE_PROXY_API_KEY || '').trim() ||
        resolvedConfig.llm.api.apiKey;
      return new LiteLlmLangfuseOutcomeReporter({
        proxyBaseUrl: resolved.proxyBaseUrl,
        proxyPathPrefix: resolved.proxyPathPrefix,
        litellmApiKey: proxyApiKey,
      });
    })();

    const loopParams = {
      instruction: allOptions.instruction,
      verify: effectiveVerify,
      repoPath: runPath,
      llm: llm,
      mode,
      dryRun: allOptions.dryRun,
      forceReset: allOptions.forceReset,
      file: allOptions.file,
      selection: allOptions.selection,
      verbose: verboseLevel,
      strategy: allOptions.checkpointStrategy as CheckpointStrategy,
      applyBackOnDirty,
      worktreePrepare: allOptions.worktreePrepare,
      llmOutput,
      outcomeReporter,
      langfuseSessionId: resolvedConfig.observability.langfuse.sessionId || sessionIdForOutput,
      langfuseUserId: resolvedConfig.observability.langfuse.userId,
      authorizationProvider: createTerminalAuthorizationProvider({
        config: resolvedConfig.toolAuthorization,
        extensions: extensionResolution?.resolved,
      }),
      extensions: extensionResolution?.resolved,
      permissionRules:
        allowedToolRules.length > 0 || disallowedToolRules.length > 0
          ? { allow: allowedToolRules, deny: disallowedToolRules }
          : undefined,
    };

    const buildAssistantMessage = (result: LoopResult) => {
      if (!result.success) return text.cli.chatFailed(result.reason);

      if (mode === 'review') return text.cli.chatReviewCompleted;

      const changedFiles = result.changedFiles ?? [];
      if (changedFiles.length === 0) return text.cli.chatNoChanges;

      return text.cli.chatSuccess(changedFiles.join(', '));
    };

    let result: LoopResult;

    if (useGui) {
      // Dynamically import GUI to avoid top-level await issues with yoga-layout
      const { startGUI } = await import('../ui/index.js');
      result = (await startGUI(
        'run',
        undefined,
        async (emit, _input, guiOptions) => {
          const authorizationProvider = createUiAuthorizationProvider({
            emit: (event) => emit({ ...event, timestamp: new Date() }),
            config: resolvedConfig.toolAuthorization,
          });
          const runResult = await runSalmonLoop({
            ...loopParams,
            applyBackOnDirty: loopParams.applyBackOnDirty as ApplyBackOnDirty,
            signal: guiOptions?.signal,
            authorizationProvider,
            authorizationMode: 'deferred',
            onEvent: (event) => {
              // In GUI mode, we only emit to the UI to prevent StandardReporter from leaking to stderr
              emit(event);
            },
          });
          if (runResult.reason !== 'Operation cancelled by user') {
            emitLlmOutput({
              emit,
              policy: llmOutput,
              kind: 'assistant_message',
              step: 'REPORT',
              content: buildAssistantMessage(runResult),
            });
          }
          return runResult;
        },
        {
          markdownTheme: resolvedConfig.markdownTheme,
          markdownRenderMode: resolvedConfig.markdownRenderMode,
          logView: resolvedConfig.ui.logView,
          logMode: resolvedConfig.ui.logMode,
        },
      )) as LoopResult;
    } else {
      result = await runSalmonLoop({
        ...loopParams,
        applyBackOnDirty: loopParams.applyBackOnDirty as ApplyBackOnDirty,
        onEvent: (event) => reporter.onEvent(event),
      });
      emitLlmOutput({
        emit: (event) => reporter.onEvent(event),
        policy: llmOutput,
        kind: 'assistant_message',
        step: 'REPORT',
        content: buildAssistantMessage(result),
      });
    }

    reporter.onFinish(result);

    if (sessionManager && typeof allOptions.instruction === 'string') {
      try {
        sessionManager.addMessage({
          role: 'user',
          content: allOptions.instruction,
          timestamp: Date.now(),
        });

        let iterationId: string | undefined;
        if (Array.isArray(result.history) && result.history.length > 0) {
          iterationId = sessionManager.addIteration(result.history[result.history.length - 1]);
        }

        if (result.reason !== 'Operation cancelled by user') {
          sessionManager.addMessage({
            role: 'assistant',
            content: buildAssistantMessage(result),
            timestamp: Date.now(),
            iterationId,
          });
        }

        await sessionManager.save();
      } catch (_error) {
        // Best-effort persistence: never block the CLI exit path.
      }
    }

    process.exitCode = resolveExitCode(result);
    return;
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(text.cli.unexpectedError(msg), false);
    if (outputFormat === 'json') {
      writeJsonFailure({
        message: text.cli.unexpectedError(msg),
        repoPath: runPath,
        instruction: allOptions.instruction,
      });
    } else if (outputFormat === 'stream-json') {
      writeStreamJsonEarlyError({
        sessionId: sessionIdForOutput ?? randomUUID(),
        message: text.cli.unexpectedError(msg),
      });
    }
    process.exit(1);
  }
}
