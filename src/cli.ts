#!/usr/bin/env node
import 'dotenv/config';
import { execSync } from 'child_process';
import { resolve } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';
import ProgressBar from 'progress';

import { CheckpointManager } from './core/checkpoint/manager.js';
import { logger } from './core/logger.js';
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
        execSync('npx eslint src --ext .ts', { stdio: 'inherit', cwd: process.cwd() });
        logger.debug(text.cli.runningTests);
        try {
          execSync('npm test', { stdio: 'inherit', cwd: process.cwd() });
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

    if (!options.instruction || !options.verify) {
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
      logger.log(text.cli.verify(options.verify));
      logger.log(text.cli.repoPath(runPath));
      if (options.file) logger.log(text.cli.contextFile(options.file));
      if (options.selection) logger.log(text.cli.contextSelection(options.selection.length));
      if (options.dryRun) logger.warn(text.cli.dryRunEnabled);
    }

    try {
      const apiKey = process.env.S8P_API_KEY || process.env.SALMON_API_KEY;
      const llm = apiKey ? new OpenAILLM() : new StubLLM();

      if (!apiKey) {
        logger.warn(text.cli.apiKeyMissing);
      }

      // Progress bar setup
      const bar = new ProgressBar(`${chalk.blue('[:bar]')} :phase :percent :elapseds`, {
        total: EXECUTION_PHASES.length,
        width: 20,
        complete: '=',
        incomplete: ' ',
      });

      let currentPhaseIndex = 0;

      const applyBackOnDirty = options.applyBackOnDirty === 'abort' ? 'abort' : '3way';

      const result = await runSalmonLoop({
        instruction: options.instruction,
        verify: options.verify,
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
            const phaseName =
              text.progress[event.phase as keyof typeof text.progress] || event.phase;
            bar.tick(currentPhaseIndex === 0 ? 0 : 1, { phase: phaseName });
            currentPhaseIndex++;
            logger.step(event.phase, phaseName);
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
            currentPhaseIndex = 0; // Reset progress for retry
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
            logger.cyan(`💡 Suggestion: ${text.suggestions.dirty}`);
          } else if (result.reasonCode === 'PREFLIGHT_NOT_GIT') {
            logger.cyan(`💡 Suggestion: ${text.suggestions.notGit}`);
          }
        } else if (result.failurePhase === Phase.VERIFY) {
          if (result.errorType === ErrorType.COMPILATION) {
            logger.cyan(`💡 Suggestion: ${text.suggestions.compilation}`);
          } else if (result.errorType === ErrorType.LINT) {
            logger.cyan(`💡 Suggestion: ${text.suggestions.lint}`);
          } else {
            logger.cyan(`💡 Suggestion: ${text.suggestions.test}`);
          }
        } else if (result.failurePhase === Phase.ROLLBACK) {
          logger.cyan(`💡 Suggestion: ${text.suggestions.rollbackFailed}`);
        }

        logger.log(text.cli.attempts(result.attempts));
        process.exit(1);
      }

      if (options.verbose) {
        logger.log('\n' + chalk.bold(text.cli.stepLogs));
        result.logs.forEach((log) => {
          const symbol = log.success ? chalk.green('✓') : chalk.red('✗');
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
  .description('Restore the repository to a specific snapshot state')
  .option('--force', 'Overwrite uncommitted changes')
  .action(async (hash, options) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      logger.info(`Restoring snapshot ${hash}...`);
      await manager.restoreToMain(runPath, hash, options.force);
      logger.success(`Successfully restored snapshot ${hash}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('Workspace is dirty')) {
        logger.error(`Restore failed: Workspace has uncommitted changes.`);
        logger.warn('Use --force to overwrite them, or commit/stash your changes first.');
      } else {
        logger.error(`Restore failed: ${msg}`);
      }
      process.exit(1);
    }
  });

const snapshot = program.command('snapshot').alias('snap').description('Manage snapshots');

snapshot
  .command('list')
  .alias('ls')
  .description('List all snapshots')
  .action(async () => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    const snapshots = await manager.listSnapshots(runPath);
    if (snapshots.length === 0) {
      logger.log('No snapshots found.');
      return;
    }
    logger.log(chalk.bold('Available Snapshots:'));
    logger.log(chalk.dim('Hash     Timestamp                  Message'));
    snapshots.forEach((s) => {
      // Parse the message to extract the description if available
      let displayMsg = s.message;
      try {
        const meta = JSON.parse(s.message);
        if (meta.desc) {
          displayMsg = meta.desc;
        } else if (meta.staged) {
          // Fallback for auto-snapshots without explicit description
          displayMsg = `Auto-snapshot (staged: ${meta.staged.substring(0, 7)})`;
        }
      } catch {
        // Keep original message if parsing fails
      }
      logger.log(`${chalk.cyan(s.hash)}  ${chalk.gray(s.timestamp)}  ${displayMsg}`);
    });
  });

snapshot
  .command('create')
  .description('Create a new snapshot manually')
  .option('-m, --message <text>', 'Description for the snapshot')
  .option('--include <files...>', 'Explicitly include ignored files')
  .action(async (options) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      const result = await manager.createSafeSnapshot(
        runPath,
        options.include || [],
        options.message,
      );
      logger.success(`Snapshot created: ${result.commitHash}`);
      if (options.message) {
        logger.log(`Message: ${options.message}`);
      }
    } catch (error) {
      logger.error(
        `Failed to create snapshot: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });

snapshot
  .command('show <hash>')
  .description('Show details of a snapshot')
  .option('--files', 'List all files contained in the snapshot')
  .action(async (hash, options) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      const details = await manager.getSnapshotDetails(runPath, hash);
      logger.log(chalk.bold(`Snapshot ${hash} Details:`));

      if (details.stagedFiles.length > 0) {
        logger.log(chalk.green('\nStaged Files:'));
        details.stagedFiles.forEach((f) => logger.log(`  ${f}`));
      } else {
        logger.log(chalk.gray('\nNo staged files.'));
      }

      if (details.unstagedFiles.length > 0) {
        logger.log(chalk.yellow('\nUnstaged Changes:'));
        details.unstagedFiles.forEach((f) => logger.log(`  ${f}`));
      } else {
        logger.log(chalk.gray('\nNo unstaged changes.'));
      }

      if (options.files) {
        logger.log(chalk.blue('\nAll Files in Snapshot:'));
        const files = await manager.getSnapshotFiles(runPath, hash);
        files.forEach((f) => logger.log(`  ${f}`));
      }
    } catch (error) {
      logger.error(
        `Failed to show snapshot: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });

snapshot
  .command('diff <hash> [otherHash]')
  .description('Show diff between snapshots or workspace')
  .option('--code', 'Show full code diff instead of summary')
  .action(async (hash, otherHash, options) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      const diffOutput = await manager.getSnapshotDiff(runPath, hash, otherHash, options.code);
      if (!diffOutput.trim()) {
        logger.log('No differences found.');
      } else {
        process.stdout.write(diffOutput + '\n');
      }
    } catch (error) {
      logger.error(`Failed to get diff: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  });

snapshot
  .command('cat <hash> <file>')
  .description('View file content from a snapshot')
  .action(async (hash, file) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      const content = await manager.getSnapshotFileContent(runPath, hash, file);
      process.stdout.write(content);
    } catch (error) {
      logger.error(
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });

snapshot
  .command('export <hash> <directory>')
  .description('Export snapshot content to a directory')
  .action(async (hash, directory) => {
    const runPath = resolve(program.opts().repo);
    const targetDir = resolve(directory);
    const manager = new CheckpointManager();
    try {
      logger.info(`Exporting snapshot ${hash} to ${targetDir}...`);
      await manager.exportSnapshot(runPath, hash, targetDir);
      logger.success(`Successfully exported snapshot ${hash}`);
    } catch (error) {
      logger.error(
        `Failed to export snapshot: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });

snapshot
  .command('delete <hash>')
  .alias('rm')
  .description('Delete a snapshot')
  .action(async (hash) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();
    try {
      await manager.deleteSnapshot(runPath, hash);
      logger.success(`Snapshot ${hash} deleted.`);
    } catch (error) {
      logger.error(
        `Failed to delete snapshot: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });

snapshot
  .command('clear')
  .description('Clear all snapshots')
  .option('--force', 'Force clear without confirmation')
  .action(async (options) => {
    const runPath = resolve(program.opts().repo);
    const manager = new CheckpointManager();

    if (!options.force) {
      logger.warn('Please use --force to clear all snapshots.');
      return;
    }

    try {
      await manager.clearSnapshots(runPath);
      logger.success('All snapshots cleared.');
    } catch (error) {
      logger.error(
        `Failed to clear snapshots: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(1);
    }
  });

program.parse();
