import { execSync } from 'child_process';
import { resolve } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';

import { redactConfigForPrint, resolveConfig, ConfigError } from '../../core/config/index.js';
import { createRuntimeLlm } from '../../core/llm/factory.js';
import { logger } from '../../core/logger.js';
import { runSalmonLoop } from '../../core/loop.js';
import {
  VerboseLevel,
  CheckpointStrategy,
  LLMStreamChunk,
  ApplyBackOnDirty,
  LoopResult,
} from '../../core/types.js';
import { text } from '../../locales/index.js';
import { SalmonReporter } from '../reporters/base.js';
import { StandardReporter } from '../reporters/standard.js';
import { startGUI } from '../ui/index.js';
import { resolveVerifyOption } from '../utils/verify-resolver.js';

export async function handleRunCommand(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());

  if (allOptions.validate) {
    logger.log(chalk.blue(text.cli.runningValidation));
    try {
      logger.debug(text.cli.runningEslint);
      execSync('npx eslint src --ext .ts', { stdio: 'inherit', cwd: runPath });
      logger.debug(text.cli.runningTests);
      try {
        execSync('npm test', { stdio: 'inherit', cwd: runPath });
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
    // Future: const reporter = options.gui ? new InkReporter() : new StandardReporter(options.verbose);
    const reporter: SalmonReporter = new StandardReporter(Boolean(allOptions.verbose));

    reporter.onStart(allOptions.instruction);

    const streamOutputEnabled = Boolean(allOptions.streamOutput);
    const applyBackOnDirty = allOptions.applyBackOnDirty === 'abort' ? 'abort' : '3way';

    const onStreamChunk = streamOutputEnabled
      ? (chunk: LLMStreamChunk) => reporter.onStreamChunk(chunk)
      : undefined;

    const loopParams = {
      instruction: allOptions.instruction,
      verify: effectiveVerify,
      repoPath: runPath,
      llm: llm,
      dryRun: allOptions.dryRun,
      forceReset: allOptions.forceReset,
      file: allOptions.file,
      selection: allOptions.selection,
      verbose: verboseLevel,
      strategy: allOptions.checkpointStrategy as CheckpointStrategy,
      applyBackOnDirty,
      worktreePrepare: allOptions.worktreePrepare,
      onStreamChunk,
    };

    let result: LoopResult;
    // Default to GUI unless explicitly disabled or not a TTY
    const useGui = allOptions.gui !== false && process.stdout.isTTY;

    if (useGui) {
      result = (await startGUI('run', async (emit) => {
        return await runSalmonLoop({
          ...loopParams,
          applyBackOnDirty: loopParams.applyBackOnDirty as ApplyBackOnDirty,
          onEvent: (event) => {
            reporter.onEvent(event);
            emit(event);
          },
        });
      })) as LoopResult;
    } else {
      result = await runSalmonLoop({
        ...loopParams,
        applyBackOnDirty: loopParams.applyBackOnDirty as ApplyBackOnDirty,
        onEvent: (event) => reporter.onEvent(event),
      });
    }

    reporter.onFinish(result);

    if (!result.success) {
      process.exit(1);
    }
  } catch (err: any) {
    logger.error(text.cli.unexpectedError(err.message), true);
    process.exit(1);
  }
}
