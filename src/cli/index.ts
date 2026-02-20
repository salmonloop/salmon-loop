#!/usr/bin/env node
// 1. MUST be the very first lines to force all chalk instances (even in node_modules)
// to use color support before they complete initialization.
process.env.FORCE_COLOR = '3';

import 'dotenv/config';
import chalk from 'chalk';
import { Command } from 'commander';

import { initializeRuntime } from '../core/runtime/initialize.js';

import { handleChatCommand } from './commands/chat.js';
import { handleContextCommand } from './commands/context.js';
import { handleRestoreCommand } from './commands/restore.js';
import { handleRunCommand } from './commands/run.js';
import {
  handleSnapshotList,
  handleSnapshotCreate,
  handleSnapshotShow,
  handleSnapshotDiff,
  handleSnapshotCat,
  handleSnapshotExport,
  handleSnapshotDelete,
  handleSnapshotClear,
} from './commands/snapshot.js';
import { text } from './locales/index.js';

// --- Global Safety Initialization ---
initializeRuntime();

// Force global chalk level
chalk.level = 3;

const program = new Command();

// --- Framework Error Hardening ---
// Prevent Commander from printing raw errors directly to terminal
program.exitOverride();

program.name('s8p').alias('salmonloop').description(text.cli.programDescription).version('0.2.0');

// --- Global Options ---
program
  .option('-r, --repo <path>', text.cli.repoOption, process.cwd())
  .option('-p, --print <instruction>', text.cli.printOption)
  .option('--continue', text.cli.continueOption)
  .option('--resume <sessionId>', text.cli.resumeOption)
  .option('-v, --verify <command>', text.cli.verifyOption)
  .option('--no-verify', 'Disable verification')
  .option('-cs, --checkpoint-strategy <type>', text.cli.checkpointStrategyOption, 'worktree')
  .option('--llm-output <kinds>', text.cli.llmOutputOption);

// --- Main Command: Run ---
program
  .command('run')
  .description(text.cli.runDescription)
  .option('-i, --instruction <instruction>', text.cli.instructionOption)
  .option('--config <path>', text.cli.configOption)
  .option('--no-config-file', text.cli.noConfigFileOption)
  .option('--print-config', text.cli.printConfigOption)
  .option('-f, --file <path>', text.cli.fileOption)
  .option('-s, --selection <text>', text.cli.selectionOption)
  .option(
    '--allowedTools <rules>',
    text.cli.allowedToolsOption,
    (value, previous: string[]) => previous.concat([value]),
    [] as string[],
  )
  .option(
    '--disallowedTools <rules>',
    text.cli.disallowedToolsOption,
    (value, previous: string[]) => previous.concat([value]),
    [] as string[],
  )
  .option('--dry-run', text.cli.dryRunOption)
  .option('--verbose [level]', text.cli.verboseOption)
  .option('--force-reset', text.cli.forceResetOption)
  .option('--validate', text.cli.validateOption)
  .option('--target-node <name>', text.cli.targetNodeOption)
  .option('--mode <mode>', text.cli.modeOption, 'patch')
  .option('--apply-back-on-dirty <mode>', text.cli.applyBackOnDirtyOption, '3way')
  .option('--worktree-prepare <command>', text.cli.worktreePrepareOption)
  .option('--stream-output', text.cli.streamOutputOption)
  .option('--output-format <format>', text.cli.outputFormatOption, 'text')
  .option('--gui', 'Enable experimental TUI mode (Ink)')
  .action(handleRunCommand);

// --- Command: Restore ---
program
  .command('restore <hash>')
  .alias('checkout')
  .description(text.cli.restoreDescription)
  .option('--force', text.cli.restoreForceOption)
  .action(handleRestoreCommand);

// --- Command: Snapshot ---
const snapshot = program
  .command('snapshot')
  .alias('snap')
  .description(text.cli.snapshotManageDescription);

snapshot
  .command('list')
  .alias('ls')
  .description(text.cli.listSnapshotsDescription)
  .action(handleSnapshotList);

snapshot
  .command('create')
  .description(text.cli.createSnapshotDescription)
  .option('-m, --message <text>', text.cli.createSnapshotMessageOption)
  .option('--include <files...>', text.cli.createSnapshotIncludeOption)
  .action(handleSnapshotCreate);

snapshot
  .command('show <hash>')
  .description(text.cli.showSnapshotDescription)
  .option('--files', text.cli.showSnapshotFilesOption)
  .action(handleSnapshotShow);

snapshot
  .command('diff <hash> [otherHash]')
  .description(text.cli.diffSnapshotDescription)
  .option('--code', text.cli.diffSnapshotCodeOption)
  .action(handleSnapshotDiff);

snapshot
  .command('cat <hash> <file>')
  .description(text.cli.catSnapshotDescription)
  .action(handleSnapshotCat);

snapshot
  .command('export <hash> <directory>')
  .description(text.cli.exportSnapshotDescription)
  .action(handleSnapshotExport);

snapshot
  .command('delete <hash>')
  .alias('rm')
  .description(text.cli.deleteSnapshotDescription)
  .action(handleSnapshotDelete);

snapshot
  .command('clear')
  .description(text.cli.clearSnapshotsDescription)
  .option('--force', text.cli.clearSnapshotsForceOption)
  .action(handleSnapshotClear);

// --- Command: Context ---
program
  .command('context')
  .description(text.cli.contextDescription)
  .option('-i, --instruction <instruction>', text.cli.instructionOption)
  .option('-f, --file <path>', text.cli.fileOption)
  .option('-s, --selection <text>', text.cli.selectionOption)
  .option('--diff-scope <scope>', text.cli.contextDiffScopeOption, 'primary')
  .option('--budget-chars <n>', text.cli.contextBudgetCharsOption)
  .action(handleContextCommand);

// --- Command: Chat ---
program
  .command('chat', { isDefault: true })
  .description('Enter interactive chat mode (default)')
  .option('--verbose [level]', text.cli.verboseOption)
  .action(handleChatCommand);

// Parse arguments with manual error handling
try {
  program.parse(rewriteArgvForPrintMode(process.argv));
} catch (err: any) {
  // Commander uses special error names for built-in logic like --help or missing args
  if (err.name === 'CommanderError') {
    // Only exit if it's not a help message
    if (err.code !== 'commander.helpDisplayed' && err.code !== 'commander.version') {
      process.exit(err.exitCode || 1);
    }
  } else {
    // This is a real application crash - send through our hardened logger
    import('../core/observability/logger.js').then(({ logger }) => {
      logger.error('CLI execution crashed', err, true);
    });
  }
}

function rewriteArgvForPrintMode(argv: string[]): string[] {
  const tokens = argv.slice(2);
  const hasPrint = tokens.some((t) => t === '-p' || t === '--print' || t.startsWith('--print='));
  if (!hasPrint) return argv;

  const knownCommands = new Set([
    'run',
    'chat',
    'context',
    'restore',
    'checkout',
    'snapshot',
    'snap',
  ]);

  const flagsWithValues = new Set([
    '-p',
    '--print',
    '-r',
    '--repo',
    '--resume',
    '-v',
    '--verify',
    '-cs',
    '--checkpoint-strategy',
    '--llm-output',
  ]);

  const startsWithAny = (value: string, prefixes: string[]) => {
    for (const prefix of prefixes) {
      if (value.startsWith(prefix)) return true;
    }
    return false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--') break;

    if (flagsWithValues.has(token)) {
      i += 1; // skip value token
      continue;
    }

    if (
      startsWithAny(token, [
        '--print=',
        '--repo=',
        '--resume=',
        '--verify=',
        '--checkpoint-strategy=',
        '--llm-output=',
      ])
    ) {
      continue;
    }

    if (token.startsWith('-')) continue;
    if (knownCommands.has(token)) return argv;
  }

  return [...argv.slice(0, 2), 'run', ...tokens];
}
