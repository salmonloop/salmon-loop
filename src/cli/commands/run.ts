import { spawnSync } from 'child_process';
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
import {
  VerboseLevel,
  CheckpointStrategy,
  ApplyBackOnDirty,
  LoopResult,
  type FlowMode,
} from '../../core/types/index.js';
import {
  createTerminalAuthorizationProvider,
  createUiAuthorizationProvider,
} from '../authorization/provider.js';
import { text } from '../locales/index.js';
import { SalmonReporter } from '../reporters/base.js';
import { StandardReporter } from '../reporters/standard.js';
import { resolveLlmOutputPolicyFromCli } from '../utils/llm-output.js';
import { resolveVerifyOption } from '../utils/verify-resolver.js';

export async function handleRunCommand(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const useGui = allOptions.gui !== false && process.stdout.isTTY;

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
      logger.error(text.config.error(err.code || err.message, err.details), true);
      process.exitCode = 1;
      return;
    }

    const msg = err instanceof Error ? err.message : String(err);
    logger.error(text.config.loadFailed(msg), true);
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
      command.help(); // Show help if required options are missing
      process.exit(1);
    }
    return;
  }

  const rawMode = String(allOptions.mode || 'patch');
  if (rawMode !== 'patch' && rawMode !== 'review' && rawMode !== 'debug') {
    logger.error(text.cli.invalidMode(rawMode), true);
    process.exit(1);
  }
  const mode = rawMode as FlowMode;

  let extensionResolution: ExtensionResolution | undefined;
  try {
    extensionResolution = await resolveExtensions({ repoRoot: runPath });
  } catch (err: any) {
    if (err instanceof ExtensionConfigError) {
      logger.error(`Extension configuration invalid: ${err.message}`, true);
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
    if (allOptions.dryRun) logger.warn(text.cli.dryRunEnabled);
    if (resolvedConfig.source.used) {
      logger.log(text.cli.configPath(resolvedConfig.source.path || ''));
    }
  }

  try {
    const llmType = resolvedConfig.llm.type;
    const clientPackage = resolvedConfig.llm.clientPackage;

    const runtimeLlm = createRuntimeLlm(resolvedConfig.llm);
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
      : new StandardReporter(Boolean(allOptions.verbose));

    reporter.onStart(allOptions.instruction);

    const applyBackOnDirty = allOptions.applyBackOnDirty === 'abort' ? 'abort' : '3way';

    if (allOptions.streamOutput && !llmOutput.kinds.includes('plan')) {
      llmOutput.kinds.push('plan');
    }

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
      authorizationProvider: createTerminalAuthorizationProvider({
        config: resolvedConfig.toolAuthorization,
      }),
      extensions: extensionResolution?.resolved,
    };

    const buildAssistantMessage = (result: LoopResult) =>
      result.success
        ? text.cli.chatSuccess(result.changedFiles?.join(', ') || 'none')
        : text.cli.chatFailed(result.reason);

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

    // Exit with code 0 regardless of success/failure to avoid redundant ELIFECYCLE errors from pnpm/npm in UI mode
    process.exit(0);
  } catch (err: any) {
    logger.error(text.cli.unexpectedError(err.message), false);
    process.exit(1);
  }
}
