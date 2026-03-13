import type { Command } from 'commander';

import { text } from './locales/index.js';

export function configureGlobalProgramOptions(program: Command): void {
  program
    .option('-r, --repo <path>', text.cli.repoOption, process.cwd())
    .option('-p, --print <instruction>', text.cli.printOption)
    .option('--continue', text.cli.continueOption)
    .option('--resume <sessionId>', text.cli.resumeOption)
    .option('-v, --verify <command>', text.cli.verifyOption)
    .option('--no-verify', 'Disable verification')
    .option('--log-mode <mode>', text.cli.logModeOption)
    .option('-cs, --checkpoint-strategy <type>', text.cli.checkpointStrategyOption, 'worktree')
    .option('--mode <mode>', text.cli.permissionModeOption, 'interactive')
    .option('--llm-output <kinds>', text.cli.llmOutputOption)
    .option('--audit-scope <scope>', text.cli.auditScopeOption);
}
