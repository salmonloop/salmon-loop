import { resolve } from 'path';

import { Command } from 'commander';

import { resolveConfig } from '../../core/config/index.js';
import { createRuntimeLlm } from '../../core/llm/factory.js';
import { logger } from '../../core/logger.js';

export async function handleChatCommand(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());

  const resolvedConfig = await resolveConfig({
    repoRoot: runPath,
    enableConfigFile: true,
  });

  const { llm } = createRuntimeLlm(resolvedConfig.llm);
  // Align with default run command: CLI option takes precedence over config
  const verifyCommand = allOptions.verify || resolvedConfig.verify.command;

  if (!verifyCommand) {
    logger.error('Verify command is required for chat mode. Use --verify or configure in .s8prc');
    process.exit(1);
  }

  // Dynamic import to avoid circular dependencies if any, and keep startup fast
  const { startChatMode } = await import('../chat.js');

  await startChatMode({
    repoPath: runPath,
    llm,
    verifyCommand,
    checkpointStrategy: allOptions.checkpointStrategy || 'worktree',
    resume: options.resume,
    verbose: options.verbose,
  });
}
