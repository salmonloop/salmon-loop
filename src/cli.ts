#!/usr/bin/env node
import 'dotenv/config';
import { execSync } from 'child_process';
import { resolve } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';
import ProgressBar from 'progress';

import { logger } from './core/logger.js';
import { ExecutionPhase, ErrorType, VerboseLevel } from './core/types.js';
import { text } from './locales/index.js';

import { runSalmonLoop, OpenAILLM, StubLLM } from './index.js';

const program = new Command();

program
  .name('salmon-loop')
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
  .option('--allow-dirty', text.cli.allowDirtyOption)
  .option('--validate', text.cli.validateOption)
  .option('--target-node <name>', 'The name of the node (e.g., function name) that is allowed to be modified')
  .action(async (options) => {
    const runPath = resolve(options.repo);

    if (options.validate) {
      logger.log(chalk.blue('🔍 Running validation checks...'));
      try {
        logger.debug('  Running ESLint...');
        execSync('npx eslint src --ext .ts', { stdio: 'inherit', cwd: process.cwd() });
        logger.debug('  Running Tests...');
        try {
          execSync('npm test', { stdio: 'inherit', cwd: process.cwd() });
        } catch (__e) {
          logger.warn('  ⚠️ Tests failed, but continuing validation...');
        }
        logger.success('✅ Validation completed!');
      } catch (__e) {
        logger.error('❌ Validation failed.', true);
      }
      if (!options.instruction) {
        return;
      }
    }

    if (!options.instruction || !options.verify) {
      if (!options.validate) {
        logger.error('Error: --instruction and --verify are required unless --validate is used.');
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
      const llm = process.env.SALMON_API_KEY ? new OpenAILLM() : new StubLLM();

      if (!process.env.SALMON_API_KEY) {
        logger.warn(text.cli.apiKeyMissing);
      }

      // Progress bar setup
      const phases = Object.values(ExecutionPhase);
      const bar = new ProgressBar(`${chalk.blue('[:bar]')} :phase :percent :elapseds`, {
        total: phases.length,
        width: 20,
        complete: '=',
        incomplete: ' ',
      });

      let currentPhaseIndex = 0;

      const result = await runSalmonLoop({
        instruction: options.instruction,
        verify: options.verify,
        repoPath: runPath,
        llm: llm,
        dryRun: options.dryRun,
        forceReset: options.forceReset,
        allowDirty: options.allowDirty,
        file: options.file,
        selection: options.selection,
        verbose: verboseLevel,
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
            logger.success(`  Files: ${event.fileCount}, Lines: ${event.lineCount}`);
          } else if (event.type === 'retry') {
            logger.warn(
              `\n🔄 Retry ${event.fromAttempt} -> ${event.toAttempt}: ${event.reason.substring(
                0,
                100,
              )}...`,
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
        if (result.failurePhase === ExecutionPhase.PREFLIGHT) {
          if (result.reasonCode === 'PREFLIGHT_DIRTY') {
            logger.cyan(`💡 Suggestion: ${text.suggestions.dirty}`);
          } else if (result.reasonCode === 'PREFLIGHT_NOT_GIT') {
            logger.cyan(`💡 Suggestion: ${text.suggestions.notGit}`);
          }
        } else if (result.failurePhase === ExecutionPhase.VERIFY) {
          if (result.errorType === ErrorType.COMPILATION) {
            logger.cyan(`💡 Suggestion: ${text.suggestions.compilation}`);
          } else if (result.errorType === ErrorType.LINT) {
            logger.cyan(`💡 Suggestion: ${text.suggestions.lint}`);
          } else {
            logger.cyan(`💡 Suggestion: ${text.suggestions.test}`);
          }
        } else if (result.failurePhase === ExecutionPhase.ROLLBACK) {
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

program.parse();
