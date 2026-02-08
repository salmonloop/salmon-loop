import { CheckpointManager } from '../../core/strata/checkpoint/manager.js';

import type { Command, CommandResult } from './types.js';
import { parseSuggestionContext } from './utils.js';

const getSnapshotSuggestions = async (sessionManager: any, currentPrefix: string) => {
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
};

const listCommand: Command = {
  name: 'list',
  description: 'List snapshots',
  usage: '/snapshot list [hash]',
  getSuggestions: async ({ sessionManager, input }) => {
    const { currentPrefix } = parseSuggestionContext(input);
    return getSnapshotSuggestions(sessionManager, currentPrefix);
  },
  execute: async ({ emit, sessionManager, input }) => {
    const args = input.trim().split(/\s+/).slice(1);
    const hash = args[1]; // /snapshot list <hash>

    if (!hash) {
        // List all logic could be added here, currently just asks for selection
        emit({
          type: 'log',
          level: 'info',
          message: 'Select a snapshot from the suggestions to view its details.',
          timestamp: new Date(),
        });
        return;
    }

    const manager = new CheckpointManager();
    const repoPath = sessionManager.getCurrent().meta.repoPath;
    const details = await manager.getSnapshotDetails(repoPath, hash);
    const stagedCount = details.stagedFiles.length;
    const unstagedCount = details.unstagedFiles.length;

    emit({
      type: 'log',
      level: 'info',
      message: `Snapshot [${hash.slice(0, 7)}] Details:\n- Staged: ${stagedCount} files\n- Unstaged: ${unstagedCount} files\n\nUse "/snapshot restore ${hash.slice(0, 7)}" to revert your workspace.`,
      timestamp: new Date(),
    });
  }
};

const createCommand: Command = {
  name: 'create',
  description: 'Create a new snapshot',
  usage: '/snapshot create [message]',
  execute: async ({ emit, sessionManager, input }) => {
    const args = input.trim().split(/\s+/).slice(1);
    const message = args.slice(1).join(' ') || 'Manual snapshot'; // /snapshot create <msg>
    const manager = new CheckpointManager();
    const repoPath = sessionManager.getCurrent().meta.repoPath;

    const result = await manager.createSafeSnapshot(repoPath, [], message);
    emit({
      type: 'log',
      level: 'info',
      message: `Snapshot created: ${result.commitHash.slice(0, 7)}`,
      timestamp: new Date(),
    });
  }
};

const deleteCommand: Command = {
  name: 'delete',
  description: 'Delete a snapshot',
  usage: '/snapshot delete <hash>',
  getSuggestions: async ({ sessionManager, input }) => {
    const { currentPrefix } = parseSuggestionContext(input);
    return getSnapshotSuggestions(sessionManager, currentPrefix);
  },
  execute: async ({ emit, sessionManager, input }) => {
    const args = input.trim().split(/\s+/).slice(1);
    const hash = args[1];

    if (!hash) {
      emit({ type: 'log', level: 'error', message: 'Usage: /snapshot delete <hash>', timestamp: new Date() });
      return;
    }

    const manager = new CheckpointManager();
    const repoPath = sessionManager.getCurrent().meta.repoPath;
    await manager.deleteSnapshot(repoPath, hash);

    emit({
      type: 'log',
      level: 'info',
      message: `Snapshot ${hash} deleted.`,
      timestamp: new Date(),
    });
  }
};

const restoreCommand: Command = {
  name: 'restore',
  description: 'Restore workspace to a snapshot',
  usage: '/snapshot restore <hash>',
  getSuggestions: async ({ sessionManager, input }) => {
    const { currentPrefix } = parseSuggestionContext(input);
    return getSnapshotSuggestions(sessionManager, currentPrefix);
  },
  execute: async ({ input }): Promise<CommandResult | void> => {
    const args = input.trim().split(/\s+/).slice(1);
    const hash = args[1];

    if (!hash) {
      // Return void, error handled by caller or we can emit here
      return { action: 'NEED_CONFIRMATION', message: 'Usage: /snapshot restore <hash>' }; // Abusing confirmation for error flow a bit or just return void
    }

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
};

export const snapshotInteractiveCommand: Command = {
  name: '/snapshot',
  description: 'Manage repository snapshots',
  order: 40,
  subcommands: [listCommand, createCommand, deleteCommand, restoreCommand],
  execute: async ({ emit, input, context }) => {
     // If this execute is called, it means the user typed "/snapshot" (and potentially args)
     // but the UI didn't drill down or the user hit enter on the main command.
     // In a robust implementation, we might delegate to subcommands here manually
     // if the input matches a subcommand pattern, to support legacy execution style.

     const args = input.trim().split(/\s+/).slice(1);
     if (args.length === 0) {
         emit({ type: 'log', level: 'info', message: 'Available subcommands: list, create, delete, restore', timestamp: new Date() });
         return;
     }

     const subCmdName = args[0].toLowerCase();
     const subCmd = [listCommand, createCommand, deleteCommand, restoreCommand].find(c => c.name === subCmdName);

     if (subCmd) {
         return subCmd.execute({ ...context, emit, input: `/snapshot ${args.join(' ')}` } as any);
     }

     emit({ type: 'log', level: 'error', message: `Unknown subcommand: ${subCmdName}`, timestamp: new Date() });
  },
};
