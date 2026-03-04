import { logger, type CheckpointStrategy } from '../../core/facades/cli-utils-worktree.js';
import { text } from '../../locales/index.js';

import { autoDetectWorktreePrepareCommand } from './detectors/index.js';

export async function resolveWorktreePrepareOption(
  repoPath: string,
  strategy: CheckpointStrategy | undefined,
  cliWorktreePrepare: string | undefined,
): Promise<string | undefined> {
  if (typeof cliWorktreePrepare === 'string' && cliWorktreePrepare.trim()) {
    return cliWorktreePrepare;
  }

  if (strategy !== 'worktree') {
    return undefined;
  }

  const detected = await autoDetectWorktreePrepareCommand(repoPath);
  if (detected) {
    logger.info(text.verify.autoDetectedWorktreePrepare(detected));
    return detected;
  }

  return undefined;
}
