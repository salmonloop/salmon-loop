import type { Command } from 'commander';

import { handleChatCommand } from './commands/chat.js';
import { handleContextCommand } from './commands/context.js';
import { handleRestoreCommand } from './commands/restore.js';
import { handleRunCommand } from './commands/run.js';
import { registerServeCommands } from './commands/serve.js';
import {
  handleSnapshotCat,
  handleSnapshotClear,
  handleSnapshotCreate,
  handleSnapshotDelete,
  handleSnapshotDiff,
  handleSnapshotExport,
  handleSnapshotList,
  handleSnapshotShow,
} from './commands/snapshot.js';
import { text } from './locales/index.js';

export function registerProgramCommands(program: Command): void {
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
    .option('--preflight-policy <policy>', text.cli.preflightPolicyOption, 'lenient')
    .option('--act-mode <mode>', text.cli.actModeOption, 'patch')
    .option('--apply-back-on-dirty <mode>', text.cli.applyBackOnDirtyOption, '3way')
    .option('--environment-mode <mode>', text.cli.environmentModeOption, 'strict')
    .option('--worktree-prepare <command>', text.cli.worktreePrepareOption)
    .option('--stream-output', text.cli.streamOutputOption)
    .option('--include-partial-messages', text.cli.includePartialMessagesOption)
    .option('--output-format <format>', text.cli.outputFormatOption, 'text')
    .option('--output-profile <profile>', text.cli.outputProfileOption)
    .option('--headless-include-tool-input', text.cli.headlessIncludeToolInputOption)
    .option('--headless-include-tool-output', text.cli.headlessIncludeToolOutputOption)
    .option('--allow-outside-cache-root', text.cli.allowOutsideCacheRootOption)
    .option(
      '--headless-include-authorization-decisions',
      text.cli.headlessIncludeAuthorizationDecisionsOption,
    )
    .option('--json-schema <schema>', text.cli.jsonSchemaOption)
    .option('--gui', 'Enable experimental TUI mode (Ink)')
    .action(handleRunCommand);

  program
    .command('restore <hash>')
    .alias('checkout')
    .description(text.cli.restoreDescription)
    .option('--force', text.cli.restoreForceOption)
    .action(handleRestoreCommand);

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

  program
    .command('context')
    .description(text.cli.contextDescription)
    .option('-i, --instruction <instruction>', text.cli.instructionOption)
    .option('--config <path>', text.cli.configOption)
    .option('--no-config-file', text.cli.noConfigFileOption)
    .option('-f, --file <path>', text.cli.fileOption)
    .option('-s, --selection <text>', text.cli.selectionOption)
    .option('--diff-scope <scope>', text.cli.contextDiffScopeOption, 'primary')
    .option('--budget-chars <n>', text.cli.contextBudgetCharsOption)
    .option('--allow-outside-cache-root', text.cli.allowOutsideCacheRootOption)
    .action(handleContextCommand);

  registerServeCommands(program);

  program
    .command('chat', { isDefault: true })
    .description('Enter interactive chat mode (default)')
    .option('--config <path>', text.cli.configOption)
    .option('--no-config-file', text.cli.noConfigFileOption)
    .option('--verbose [level]', text.cli.verboseOption)
    .action(handleChatCommand);
}
