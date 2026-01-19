#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { resolve } from 'path';
import chalk from 'chalk';
import ProgressBar from 'progress';
import { execSync } from 'child_process';
import { runSalmonLoop, OpenAILLM, StubLLM } from './index.js';
import { text } from './locales/index.js';
import { ExecutionPhase, ErrorType, VerboseLevel } from './core/types.js';

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
  .action(async (options) => {
    const runPath = resolve(options.repo);

    if (options.validate) {
      console.log(chalk.blue('🔍 Running validation checks...'));
      try {
        console.log(chalk.gray('  Running ESLint...'));
        execSync('npx eslint src --ext .ts', { stdio: 'inherit', cwd: process.cwd() });
        console.log(chalk.gray('  Running Tests...'));
        try {
          execSync('npm test', { stdio: 'inherit', cwd: process.cwd() });
        } catch (_e) {
          console.warn(chalk.yellow('  ⚠️ Tests failed, but continuing validation...'));
        }
        console.log(chalk.green('✅ Validation completed!'));
      } catch (_e) {
        console.error(chalk.red('❌ Validation failed.'));
        process.exit(1);
      }
      if (!options.instruction) {
        return;
      }
    }

    if (!options.instruction || !options.verify) {
      if (!options.validate) {
        console.error(
          chalk.red('Error: --instruction and --verify are required unless --validate is used.'),
        );
        program.help(); // Show help if required options are missing
        process.exit(1);
      }
      return;
    }

    const verboseLevel =
      options.verbose === true ? 'basic' : (options.verbose as VerboseLevel | undefined);

    if (verboseLevel) {
      console.log(chalk.cyan(text.cli.runningWith));
      console.log(text.cli.instruction(options.instruction));
      console.log(text.cli.verify(options.verify));
      console.log(text.cli.repoPath(runPath));
      if (options.file) console.log(text.cli.contextFile(options.file));
      if (options.selection) console.log(text.cli.contextSelection(options.selection.length));
      if (options.dryRun) console.log(chalk.yellow(text.cli.dryRunEnabled));
    }

    try {
      const llm = process.env.SALMON_API_KEY ? new OpenAILLM() : new StubLLM();

      if (!process.env.SALMON_API_KEY) {
        console.warn(chalk.yellow(text.cli.apiKeyMissing));
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
            if (options.verbose) {
              console.log(chalk.blue(`\n[${event.phase.toUpperCase()}] `) + phaseName);
            }
          } else if (event.type === 'log') {
            if (event.level === 'error') {
              console.error(chalk.red(`  ${event.message}`));
            } else if (event.level === 'warn') {
              console.warn(chalk.yellow(`  ${event.message}`));
            } else if (options.verbose) {
              console.log(chalk.gray(`  ${event.message}`));
            }
          } else if (event.type === 'verify.result') {
            if (!event.ok) {
              console.error(chalk.red('\n' + text.cli.operationFailed));
              console.error(chalk.gray(event.output));
            }
          } else if (event.type === 'diff.meta') {
            if (options.verbose) {
              console.log(chalk.green(`  Files: ${event.fileCount}, Lines: ${event.lineCount}`));
            }
          } else if (event.type === 'retry') {
            console.log(
              chalk.yellow(
                `\n🔄 Retry ${event.fromAttempt} -> ${event.toAttempt}: ${event.reason.substring(
                  0,
                  100,
                )}...`,
              ),
            );
            currentPhaseIndex = 0; // Reset progress for retry
          }
        },
      });

      if (result.success) {
        bar.terminate();
        console.log(chalk.green(text.cli.operationSuccess));
        console.log(text.cli.attempts(result.attempts));
      } else {
        bar.terminate();
        console.error(chalk.red(text.cli.operationFailed));
        console.error(chalk.bold(text.cli.reason(result.reason)));

        // Provide suggestions based on failure
        if (result.failurePhase === ExecutionPhase.PREFLIGHT) {
          if (result.reasonCode === 'PREFLIGHT_DIRTY') {
            console.log(chalk.cyan(`💡 Suggestion: ${text.suggestions.dirty}`));
          } else if (result.reasonCode === 'PREFLIGHT_NOT_GIT') {
            console.log(chalk.cyan(`💡 Suggestion: ${text.suggestions.notGit}`));
          }
        } else if (result.failurePhase === ExecutionPhase.VERIFY) {
          if (result.errorType === ErrorType.COMPILATION) {
            console.log(chalk.cyan(`💡 Suggestion: ${text.suggestions.compilation}`));
          } else if (result.errorType === ErrorType.LINT) {
            console.log(chalk.cyan(`💡 Suggestion: ${text.suggestions.lint}`));
          } else {
            console.log(chalk.cyan(`💡 Suggestion: ${text.suggestions.test}`));
          }
        } else if (result.failurePhase === ExecutionPhase.ROLLBACK) {
          console.log(chalk.cyan(`💡 Suggestion: ${text.suggestions.rollbackFailed}`));
        }

        console.log(text.cli.attempts(result.attempts));
        process.exit(1);
      }

      if (options.verbose) {
        console.log('\n' + chalk.bold(text.cli.stepLogs));
        result.logs.forEach((log) => {
          const symbol = log.success ? chalk.green('✓') : chalk.red('✗');
          console.log(`${symbol} [${chalk.blue(log.step.toUpperCase())}] ${log.output}`);
        });
      }
    } catch (err: any) {
      console.error(chalk.red(text.cli.unexpectedError(err.message)));
      process.exit(1);
    }
  });

program.parse();
