#!/usr/bin/env node
import 'dotenv/config';
import { execSync } from 'child_process';
import { resolve } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';
import ProgressBar from 'progress';

import { redactConfigForPrint, resolveConfig } from './core/config/index.js';
import { ConfigError } from './core/config/index.js';
import { logger } from './core/logger.js';
import { CheckpointManager } from './core/strata/checkpoint/manager.js';
import {
  EXECUTION_PHASES,
  Phase,
  ErrorType,
  VerboseLevel,
  CheckpointStrategy,
} from './core/types.js';
import { text } from './locales/index.js';

import { runSalmonLoop, OpenAILLM, StubLLM } from './index.js';

const program = new Command();

program
  .name('s8p')
  .alias('salmonloop')
  .description(text.cli.programDescription)
  .version('0.2.0')
  .option('-i, --instruction <instruction>', text.cli.instructionOption)
  .option('-v, --verify <command>', text.cli.verifyOption)
  .option('--config <path>', text.cli.configOption)
  .option('--no-config-file', text.cli.noConfigFileOption)
  .option('--print-config', text.cli.printConfigOption)
  .option('-r, --repo <path>', text.cli.repoOption, process.cwd())
  .option('-f, --file <path>', text.cli.fileOption)
  .option('-s, --selection <text>', text.cli.selectionOption)
  .option('--dry-run', text.cli.dryRunOption)
  .option('--verbose [level]', text.cli.verboseOption)
  .option('--force-reset', text.cli.forceResetOption)
  .option('--validate', text.cli.validateOption)
  .option('--target-node <name>', text.cli.targetNodeOption)
  .option('-cs, --checkpoint-strategy <type>', text.cli.checkpointStrategyOption, 'direct')
  .option('--apply-back-on-dirty <mode>', text.cli.applyBackOnDirtyOption, '3way')
  .option('--worktree-prepare <command>', text.cli.worktreePrepareOption)
  .action(async (options) => {
    const runPath = resolve(options.repo);

    if (options.validate) {
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
        configFilePath: options.config,
        enableConfigFile: options.configFile !== false,
      });
    } catch (err: any) {
      if (err instanceof ConfigError) {
        logger.error(text.config.error(err.code || err.message, err.details), true);
        return;
      }

      const msg = err instanceof Error ? err.message : String(err);
      logger.error(text.config.loadFailed(msg), true);
      return;
    }

    if (options.printConfig) {
      const raw = resolvedConfig.raw || { version: 1 };
      const redacted = redactConfigForPrint(raw);
      process.stdout.write(JSON.stringify(redacted, null, 2) + '\n');
      return;
    }

    const effectiveVerify = options.verify || resolvedConfig.verify.command;

    if (!options.instruction || !effectiveVerify) {
      if (!options.validate) {
        logger.error(text.cli.optionsRequired);
        program.help(); // Show help if required options are missing
        process.exit(1);
      }
      return;
    }

    const verboseLevel =
      options.verbose === true ? 'basic' : (options.verbose as VerboseLevel | undefined);

    if (verboseLevel) {
      logger.setVerbose(verboseLevel);
      logger.cyan(text.cli.runningWith);
      logger.log(text.cli.instruction(options.instruction));
      logger.log(text.cli.verify(effectiveVerify));
      logger.log(text.cli.repoPath(runPath));
      if (options.file) logger.log(text.cli.contextFile(options.file));
      if (options.selection) logger.log(text.cli.contextSelection(options.selection.length));
      if (options.dryRun) logger.warn(text.cli.dryRunEnabled);
      if (resolvedConfig.source.used) {
        logger.log(text.cli.configPath(resolvedConfig.source.path || ''));
      }
    }

    try {
      const llmType = resolvedConfig.llm.type;
      const isOpenAiCompatible = llmType === 'openai-compatible' || llmType === 'openai';
      const apiKey = resolvedConfig.llm.api.apiKey;

      const llm =
        apiKey && isOpenAiCompatible
          ? new OpenAILLM({
              apiKey,
              baseUrl: resolvedConfig.llm.api.baseUrl,
              modelId: resolvedConfig.llm.models.selectedModelId,
            })
          : new StubLLM();

      if (!apiKey) {
        logger.warn(text.cli.apiKeyMissing);
      } else if (!isOpenAiCompatible) {
        logger.warn(text.cli.providerNotSupported(llmType));
      }

      // Progress bar setup
      const createProgressBar = () =>
        new ProgressBar(`${chalk.blue('[:bar]')} :phase :percent :elapseds`, {
          total: EXECUTION_PHASES.length,
          width: 20,
          complete: '=',
          incomplete: ' ',
        });

      // Use phase.start to render labels and phase.end to advance progress.
      // This avoids off-by-one errors and stays aligned with EXECUTION_PHASES (SSOT).
      let bar = createProgressBar();

      const applyBackOnDirty = options.applyBackOnDirty === 'abort' ? 'abort' : '3way';

      const result = await runSalmonLoop({
        instruction: options.instruction,
        verify: effectiveVerify,
        repoPath: runPath,
        llm: llm,
        dryRun: options.dryRun,
        forceReset: options.forceReset,
        file: options.file,
        selection: options.selection,
        verbose: verboseLevel,
        strategy: options.checkpointStrategy as CheckpointStrategy,
        applyBackOnDirty,
        worktreePrepare: options.worktreePrepare,
        onEvent: (event) => {
          if (event.type === 'phase.start') {
            const phaseKey = event.phase.toLowerCase() as keyof typeof text.progress;
            const phaseName = text.progress[phaseKey] || event.phase;
            bar.render({ phase: phaseName });
            logger.step(event.phase, phaseName);
          } else if (event.type === 'phase.end') {
            const phaseKey = event.phase.toLowerCase() as keyof typeof text.progress;
            const phaseName = text.progress[phaseKey] || event.phase;
            bar.tick(1, { phase: phaseName });
          } else if (event.type === 'log') {
            if (event.level === 'error') {
              logger.error(`  ${event.message}`);
            } else if (event.level === 'warn') {
              logger.warn(`  ${event.message}`);
            } else if (event.level === 'trace') {
              logger.trace(`  ${event.message}`);
            } else {
              logger.debug(`  ${event.message}`);
            }
          } else if (event.type === 'verify.result') {
            if (!event.ok) {
              logger.error('\n' + text.cli.operationFailed);
              logger.debug(event.output);
            }
          } else if (event.type === 'diff.meta') {
            logger.success(text.cli.diffMeta(event.fileCount, event.lineCount));
          } else if (event.type === 'retry') {
            logger.warn(
              text.cli.retry(
                event.fromAttempt,
                event.toAttempt,
                event.reason.substring(0, 100) + '...',
              ),
            );

            // Reset progress for retry (new bar avoids curr bookkeeping drift).
            bar.terminate();
            bar = createProgressBar();
          }
        },
      });

      if (result.success) {
        bar.terminate();
        logger.success(text.cli.operationSuccess);
        logger.log(text.cli.attempts(result.attempts));
      } else {
        bar.terminate();
        logger.error(text.cli.operationFailed);
        logger.bold(text.cli.reason(result.reason));

        // Provide suggestions based on failure
        if (result.failurePhase === Phase.PREFLIGHT) {
          if (result.reasonCode === 'PREFLIGHT_DIRTY') {
            logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.dirty}`);
          } else if (result.reasonCode === 'PREFLIGHT_NOT_GIT') {
            logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.notGit}`);
          }
        } else if (result.failurePhase === Phase.VERIFY) {
          if (result.errorType === ErrorType.COMPILATION) {
            logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.compilation}`);
          } else if (result.errorType === ErrorType.LINT) {
            logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.lint}`);
          } else {
            logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.test}`);
          }
        } else if (result.failurePhase === Phase.ROLLBACK) {
          logger.cyan(`${text.symbols.suggestion} Suggestion: ${text.suggestions.rollbackFailed}`);
        }

        logger.log(text.cli.attempts(result.attempts));
        process.exit(1);
      }

      if (options.verbose) {
        logger.log('\n' + chalk.bold(text.cli.stepLogs));
        result.logs.forEach((log) => {
          const symbol = log.success
            ? chalk.green(text.symbols.success)
            : chalk.red(text.symbols.error);
          logger.log(`${symbol} [${chalk.blue(log.step.toUpperCase())}] ${log.output}`);
        });
      }
    } catch (err: any) {
      logger.error(text.cli.unexpectedError(err.message), true);
    }
  });

program
  .command('restore <hash>')
  .alias('checkout')
  .description(text.cli.restoreDescription)
  .option('--force', text.cli.restoreForceOption)
  .action(async (hash, options) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      logger.info(text.cli.restoreStarting(hash));
      await manager.restoreToMain(runPath, hash, options.force);
      logger.success(text.cli.restoreSuccess(hash));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Workspace is dirty')) {
        logger.error(text.cli.restoreFailedDirty);
        logger.warn(text.cli.restoreFailedDirtyHint);
      } else {
        logger.error(text.cli.restoreFailed(msg));
      }
      process.exit(1);
    }
  });

const snapshot = program
  .command('snapshot')
  .alias('snap')
  .description(text.cli.snapshotManageDescription);

snapshot
  .command('list')
  .alias('ls')
  .description(text.cli.listSnapshotsDescription)
  .action(async () => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    const snapshots = await manager.listSnapshots(runPath);
    if (snapshots.length === 0) {
      logger.log(text.cli.noSnapshots);
      return;
    }
    logger.log(chalk.bold(text.cli.availableSnapshots));
    logger.log(chalk.dim(text.cli.snapshotTableHead));
    snapshots.forEach((s) => {
      // Parse the message to extract the description if available
      let displayMsg = s.message;
      try {
        const meta = JSON.parse(s.message);
        if (meta.desc) {
          displayMsg = meta.desc;
        } else if (meta.staged) {
          // Fallback for auto-snapshots without explicit description
          displayMsg = text.cli.autoSnapshotMsg(meta.staged.substring(0, 7));
        }
      } catch {
        // Keep original message if parsing fails
      }
      logger.log(`${chalk.cyan(s.hash)}  ${chalk.gray(s.timestamp)}  ${displayMsg}`);
    });
  });

snapshot
  .command('create')
  .description(text.cli.createSnapshotDescription)
  .option('-m, --message <text>', text.cli.createSnapshotMessageOption)
  .option('--include <files...>', text.cli.createSnapshotIncludeOption)
  .action(async (options) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      const result = await manager.createSafeSnapshot(
        runPath,
        options.include || [],
        options.message,
      );
      logger.success(text.cli.snapshotCreated(result.commitHash));
      if (options.message) {
        logger.log(text.cli.snapshotMessage(options.message));
      }
    } catch (error) {
      logger.error(
        text.cli.snapshotCreateFailed(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

snapshot
  .command('show <hash>')
  .description(text.cli.showSnapshotDescription)
  .option('--files', text.cli.showSnapshotFilesOption)
  .action(async (hash, options) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      const details = await manager.getSnapshotDetails(runPath, hash);
      logger.log(chalk.bold(text.cli.snapshotDetails(hash)));

      if (details.stagedFiles.length > 0) {
        logger.log(chalk.green('\n' + text.cli.stagedFiles));
        details.stagedFiles.forEach((f) => logger.log(`  ${f}`));
      } else {
        logger.log(chalk.gray('\n' + text.cli.noStagedFiles));
      }

      if (details.unstagedFiles.length > 0) {
        logger.log(chalk.yellow('\n' + text.cli.unstagedChanges));
        details.unstagedFiles.forEach((f) => logger.log(`  ${f}`));
      } else {
        logger.log(chalk.gray('\n' + text.cli.noUnstagedChanges));
      }

      if (options.files) {
        logger.log(chalk.blue('\n' + text.cli.allFilesInSnapshot));
        const files = await manager.getSnapshotFiles(runPath, hash);
        files.forEach((f) => logger.log(`  ${f}`));
      }
    } catch (error) {
      logger.error(
        text.cli.snapshotShowFailed(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

snapshot
  .command('diff <hash> [otherHash]')
  .description(text.cli.diffSnapshotDescription)
  .option('--code', text.cli.diffSnapshotCodeOption)
  .action(async (hash, otherHash, options) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      const diffOutput = await manager.getSnapshotDiff(runPath, hash, otherHash, options.code);
      if (!diffOutput.trim()) {
        logger.log(text.cli.noDifferences);
      } else {
        process.stdout.write(diffOutput + '\n');
      }
    } catch (error) {
      logger.error(text.cli.getDiffFailed(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

snapshot
  .command('cat <hash> <file>')
  .description(text.cli.catSnapshotDescription)
  .action(async (hash, file) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      const content = await manager.getSnapshotFileContent(runPath, hash, file);
      process.stdout.write(content);
    } catch (error) {
      logger.error(text.cli.readFileFailed(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

snapshot
  .command('export <hash> <directory>')
  .description(text.cli.exportSnapshotDescription)
  .action(async (hash, directory) => {
    const runPath = resolve(program.opts().repo);
    const targetDir = resolve(directory);
    const manager = new CheckpointManager();
    try {
      logger.info(text.cli.exportStarting(hash, targetDir));
      await manager.exportSnapshot(runPath, hash, targetDir);
      logger.success(text.cli.exportSuccess(hash));
    } catch (error) {
      logger.error(text.cli.exportFailed(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

snapshot
  .command('delete <hash>')
  .alias('rm')
  .description(text.cli.deleteSnapshotDescription)
  .action(async (hash) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      await manager.deleteSnapshot(runPath, hash);
      logger.success(text.cli.snapshotDeleted(hash));
    } catch (error) {
      logger.error(
        text.cli.snapshotDeleteFailed(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

snapshot
  .command('clear')
  .description(text.cli.clearSnapshotsDescription)
  .option('--force', text.cli.clearSnapshotsForceOption)
  .action(async (options) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();

    if (!options.force) {
      logger.warn(text.cli.clearForcePrompt);
      return;
    }

    try {
      await manager.clearSnapshots(runPath);
      logger.success(text.cli.allSnapshotsCleared);
    } catch (error) {
      logger.error(
        text.cli.clearSnapshotsFailed(error instanceof Error ? error.message : String(error)),
      );
      process.exit(1);
    }
  });

program.parse();
