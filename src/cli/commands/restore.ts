import { resolve } from 'path';

import { Command } from 'commander';

import { logger } from '../../core/logger.js';
import { CheckpointManager } from '../../core/strata/checkpoint/manager.js';
import { text } from '../../locales/index.js';

export async function handleRestoreCommand(hash: string, options: any, command: Command) {
  // Use optsWithGlobals() to get merged options if repo is defined globally
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const manager = new CheckpointManager();

  try {
    logger.info(text.cli.restoreStarting(hash));
    await manager.restoreToMain(runPath, hash, options.force);
    logger.success(text.cli.restoreSuccess(hash));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Workspace is dirty')) {
      logger.error(text.cli.restoreFailedDirty);
      logger.warn(text.cli.restoreFailedDirtyHint);
    } else {
      logger.error(text.cli.restoreFailed(msg));
    }
    process.exit(1);
  }
}
