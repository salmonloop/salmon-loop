import { CheckpointManager } from '../../core/strata/checkpoint/manager.js';

import type { Command, CommandResult } from './types.js';
import { parseSuggestionContext } from './utils.js';

export const snapshotInteractiveCommand: Command = {
  name: '/snapshot',
  description: 'Manage repository snapshots (list, create, delete, restore)',
  order: 40,
  getSuggestions: async ({ sessionManager, input }) => {
    const { argIndex, currentPrefix } = parseSuggestionContext(input);
    const parts = input.trimStart().split(/\s+/);

    // Level 1: Sub-command suggestions
    if (argIndex === 1) {
      const subCommands = ['list', 'create', 'delete', 'restore'];
      const search = currentPrefix.toLowerCase();
      return subCommands
        .filter((s) => s.startsWith(search))
        .map((s) => ({ name: s, description: `Snapshot ${s} command` }));
    }

    // Level 2: Data suggestions (hashes)
    if (argIndex === 2) {
      const subAction = parts[1]?.toLowerCase();
      if (['restore', 'delete', 'list'].includes(subAction)) {
        const manager = new CheckpointManager();
        const repoPath = sessionManager.getCurrent().meta.repoPath;
        const snapshots = await manager.listSnapshots(repoPath);
        const search = currentPrefix.toLowerCase();
        return snapshots
          .filter((s) => s.hash.toLowerCase().startsWith(search))
          .map((s) => ({
            name: s.hash.slice(0, 7),
            description: s.message,
          }));
      }
    }

    return [];
  },
  execute: async ({ emit, sessionManager, input }): Promise<CommandResult | void> => {
    const args = input.trim().split(/\s+/).slice(1);
    const subCommand = args[0]?.toLowerCase();
    const repoPath = sessionManager.getCurrent().meta.repoPath;
    const manager = new CheckpointManager();

    if (subCommand === 'list') {
      const hash = args[1];
      if (!hash) {
        emit({
          type: 'log',
          level: 'info',
          message: 'Select a snapshot from the suggestions below to view its details.',
          timestamp: new Date(),
        });
        return;
      }

      const details = await manager.getSnapshotDetails(repoPath, hash);
      const stagedCount = details.stagedFiles.length;
      const unstagedCount = details.unstagedFiles.length;

      emit({
        type: 'log',
        level: 'info',
        message: `Snapshot [${hash.slice(0, 7)}] Details:\n- Staged: ${stagedCount} files\n- Unstaged: ${unstagedCount} files\n\nUse "/snapshot restore ${hash.slice(0, 7)}" to revert your workspace.`,
        timestamp: new Date(),
      });
      return;
    }

    if (subCommand === 'create') {
      const message = args.slice(1).join(' ') || 'Manual snapshot';
      const result = await manager.createSafeSnapshot(repoPath, [], message);
      emit({
        type: 'log',
        level: 'info',
        message: `Snapshot created: ${result.commitHash.slice(0, 7)}`,
        timestamp: new Date(),
      });
      return;
    }

    if (subCommand === 'delete') {
      const hash = args[1];
      if (!hash) {
        emit({
          type: 'log',
          level: 'error',
          message: 'Usage: /snapshot delete <hash>',
          timestamp: new Date(),
        });
        return;
      }
      await manager.deleteSnapshot(repoPath, hash);
      emit({
        type: 'log',
        level: 'info',
        message: `Snapshot ${hash} deleted.`,
        timestamp: new Date(),
      });
      return;
    }

    if (subCommand === 'restore') {
      const hash = args[1];
      if (!hash) {
        emit({
          type: 'log',
          level: 'error',
          message: 'Usage: /snapshot restore <hash>',
          timestamp: new Date(),
        });
        return;
      }
      // Intercept for high-risk operation
      return {
        action: 'NEED_CONFIRMATION',
        message: `Restore will overwrite your current workspace.`,
        data: {
          command: '/snapshot',
          args: ['restore', hash],
          challenge: hash.slice(0, 6),
        },
      };
    }

    emit({
      type: 'log',
      level: 'error',
      message: 'Unknown subcommand. Use list, create, delete, or restore.',
      timestamp: new Date(),
    });
  },
};
