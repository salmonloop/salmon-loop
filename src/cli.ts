#!/usr/bin/env node

import { Command } from 'commander';
import { ContextBuilder } from './core/context.js';
import { text } from './locales/index.js';
import type { RunOptions } from './core/types.js';

const program = new Command();

program
  .name('salmon-loop')
  .description(text.cli.programDescription)
  .version('0.1.0');

program
  .command('run')
  .description(text.cli.runDescription)
  .requiredOption('--instruction <string>', text.cli.instructionOption)
  .requiredOption('--verify <string>', text.cli.verifyOption)
  .option('--repo <path>', text.cli.repoOption, process.cwd())
  .option('--file <path>', text.cli.fileOption)
  .option('--selection <string>', text.cli.selectionOption)
  .option('--dry-run', text.cli.dryRunOption)
  .option('--verbose', text.cli.verboseOption)
  .action(async (options: any) => {
    // 参数验证
    if (!options.instruction) {
      console.error(text.cli.instructionRequired);
      process.exit(1);
    }
    if (!options.verify) {
      console.error(text.cli.verifyRequired);
      process.exit(1);
    }
    if (options.file && options.selection) {
      console.error(text.cli.fileSelectionConflict);
      process.exit(1);
    }

    // 转换为 RunOptions
    const runOptions: RunOptions = {
      instruction: options.instruction,
      verify: options.verify,
      repo: options.repo,
      file: options.file,
      selection: options.selection,
      dryRun: options.dryRun,
      verbose: options.verbose
    };

    try {
      console.log(text.cli.starting);
      console.log(text.cli.instruction(runOptions.instruction));
      console.log(text.cli.verify(runOptions.verify));
      if (runOptions.file) {
        console.log(text.cli.fileOption + ': ' + runOptions.file);
      }
      if (runOptions.selection) {
        console.log('Selection: [provided text]');
      }
      console.log('');

      // 构建上下文
      const context = await ContextBuilder.build(runOptions);
      console.log('Context built successfully');
      console.log(`- Primary text: ${context.primaryText ? '有内容' : 'undefined'}`);
      console.log(`- Search results: ${context.rgSnippets.length} 条`);
      console.log(`- Git diff: ${context.gitDiff ? '有内容' : 'undefined'}`);

      console.log('\n✅ Day 1-2 功能验证通过');
    } catch (error) {
      console.error(text.cli.error(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

program.parse();