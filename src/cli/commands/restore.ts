import { resolve } from 'path';

import { Command } from 'commander';

import { CheckpointManager, getLogger } from '../../core/facades/cli-command-checkpoint.js';
import { text } from '../locales/index.js';

export async function handleRestoreCommand(hash: string, options: any, command: Command) {
  // Use optsWithGlobals() to get merged options if repo is defined globally
  const allOptions = command.optsWithGlobals();
  const runPath = resolve(allOptions.repo || process.cwd());
  const manager = new CheckpointManager();

  try {
    getLogger().info(text.cli.restoreStarting(hash));
    await manager.restoreToMain(runPath, hash, options.force);
    getLogger().success(text.cli.restoreSuccess(hash));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('Workspace is dirty')) {
      getLogger().error(text.cli.restoreFailedDirty);
      getLogger().warn(text.cli.restoreFailedDirtyHint);
    } else {
      getLogger().error(text.cli.restoreFailed(msg));
    }
    process.exit(1);
  }
}
