#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import { resolve } from 'path';
import { runSalmonLoop, OpenAILLM, StubLLM } from './index.js';
import { text } from './locales/index.js';

const program = new Command();

program
  .name('salmon-loop')
  .description(text.cli.programDescription)
  .version('0.1.0');

program
  .command('run', { isDefault: true })
  .description(text.cli.runDescription)
  .requiredOption('-i, --instruction <instruction>', text.cli.instructionOption)
  .requiredOption('-v, --verify <command>', text.cli.verifyOption)
  .option('-r, --repo <path>', text.cli.repoOption, process.cwd())
  .option('-f, --file <path>', text.cli.fileOption)
  .option('-s, --selection <text>', text.cli.selectionOption)
  .option('--dry-run', text.cli.dryRunOption)
  .option('--verbose', text.cli.verboseOption)
  .option('--force-reset', text.cli.forceResetOption)
  .option('--allow-dirty', text.cli.allowDirtyOption)
  .action(async (options) => {
    const runPath = resolve(options.repo);
    
    if (options.verbose) {
      console.log(text.cli.runningWith);
      console.log(text.cli.instruction(options.instruction));
      console.log(text.cli.verify(options.verify));
      console.log(text.cli.repoPath(runPath));
      if (options.file) console.log(text.cli.contextFile(options.file));
      if (options.selection) console.log(text.cli.contextSelection(options.selection.length));
      if (options.dryRun) console.log(text.cli.dryRunEnabled);
    }

    try {
      if (options.verbose) {
        console.log(text.cli.starting);
      }

      const llm = process.env.SALMON_API_KEY ? new OpenAILLM() : new StubLLM();

      if (!process.env.SALMON_API_KEY) {
        console.warn(text.cli.apiKeyMissing);
      }

      const result = await runSalmonLoop({
        instruction: options.instruction,
        verify: options.verify,
        repoPath: runPath,
        llm: llm,
        dryRun: options.dryRun,
        forceReset: options.forceReset,
        allowDirty: options.allowDirty
      });

      if (result.success) {
        console.log(text.cli.operationSuccess);
        console.log(text.cli.attempts(result.attempts));
      } else {
        console.error(text.cli.operationFailed);
        console.error(text.cli.reason(result.reason));
        console.error(text.cli.attempts(result.attempts));
        process.exit(1);
      }

      if (options.verbose) {
        console.log('\n' + text.cli.stepLogs);
        result.logs.forEach(log => {
          const symbol = log.success ? '✓' : '✗';
          console.log(`${symbol} [${log.step.toUpperCase()}] ${log.output}`);
        });
      }

    } catch (err: any) {
      console.error(text.cli.unexpectedError(err.message));
      process.exit(1);
    }
  });

program.parse();
