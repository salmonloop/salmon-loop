import { resolve } from 'path';

import { Command } from 'commander';

import { resolveConfig } from '../../core/config/index.js';
import { createRuntimeLlm } from '../../core/llm/factory.js';
import { logger } from '../../core/logger.js';
import { text } from '../../locales/index.js';
import { resolveVerifyOption } from '../utils/verify-resolver.js';

export async function handleChatCommand(options: any, command: Command) {
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());

  const resolvedConfig = await resolveConfig({
    repoRoot: runPath,
    enableConfigFile: true,
  });

  const { llm } = createRuntimeLlm(resolvedConfig.llm);

  // Smart verification resolution with auto-detection
  const verifyCommand = await resolveVerifyOption(
    runPath,
    allOptions.verify,
    resolvedConfig.verify.command,
  );

  // Verification is now optional - the loop will skip if undefined
  if (!verifyCommand) {
    logger.warn(text.verify.noCommandFound);
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
