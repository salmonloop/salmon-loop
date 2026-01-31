#!/usr/bin/env node
import 'dotenv/config';

import { Command } from 'commander';

import { text } from '../locales/index.js';

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

const program = new Command();

program.name('s8p').alias('salmonloop').description(text.cli.programDescription).version('0.2.0');

// --- Global Options ---
program
  .option('-r, --repo <path>', text.cli.repoOption, process.cwd())
  .option('-v, --verify <command>', text.cli.verifyOption)
  .option('--no-verify', 'Disable verification')
  .option('-cs, --checkpoint-strategy <type>', text.cli.checkpointStrategyOption, 'worktree');

// --- Main Command: Run ---
program
  .command('run', { isDefault: true })
  .description('Run the main loop (default)')
  .option('-i, --instruction <instruction>', text.cli.instructionOption)
  .option('--config <path>', text.cli.configOption)
  .option('--no-config-file', text.cli.noConfigFileOption)
  .option('--print-config', text.cli.printConfigOption)
  .option('-f, --file <path>', text.cli.fileOption)
  .option('-s, --selection <text>', text.cli.selectionOption)
  .option('--dry-run', text.cli.dryRunOption)
  .option('--verbose [level]', text.cli.verboseOption)
  .option('--force-reset', text.cli.forceResetOption)
  .option('--validate', text.cli.validateOption)
  .option('--target-node <name>', text.cli.targetNodeOption)
  .option('--apply-back-on-dirty <mode>', text.cli.applyBackOnDirtyOption, '3way')
  .option('--worktree-prepare <command>', text.cli.worktreePrepareOption)
  .option('--stream-output', text.cli.streamOutputOption)
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
  .command('chat')
  .description('Enter interactive chat mode')
  .option('--resume', 'Resume last session')
  .option('--verbose', 'Verbose output')
  .action(handleChatCommand);

// Parse arguments
program.parse();
