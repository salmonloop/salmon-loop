import { CheckpointManager } from '../../core/strata/checkpoint/manager.js';
import { text } from '../locales/index.js';

import { Command, CommandContext, CommandResult } from './types.js';

export const commands: Command[] = [
  {
    name: '/exit',
    description: text.cli.commandExit,
    execute: () => process.exit(0),
  },
  {
    name: '/quit',
    description: text.cli.commandExit,
    execute: () => process.exit(0),
  },
  {
    name: '/status',
    description: text.cli.commandStatus,
    execute: ({ emit, sessionManager }) => {
      const session = sessionManager.getCurrent();
      const statusMsg = [
        `Session: ${session.meta.name}`,
        `ID: ${session.meta.id.slice(0, 8)}`,
        `Iterations: ${session.meta.totalIterations} (${session.meta.successfulIterations} ok)`,
        `Messages: ${session.messages.length}`,
      ].join(' | ');
      emit({ type: 'log', level: 'info', message: statusMsg, timestamp: new Date() });
    },
  },
  {
    name: '/clear',
    description: text.cli.commandClear,
    execute: ({ emit }) => {
      emit({ type: 'checkpoint.created', worktreePath: '', baseRef: '', timestamp: new Date() });
    },
  },
  {
    name: '/help',
    description: 'Show available commands',
    execute: ({ emit }) => {
      const helpMsg = commands.map((c) => `${c.name.padEnd(10)} - ${c.description}`).join('\n');
      emit({
        type: 'log',
        level: 'info',
        message: `Available Commands:\n${helpMsg}`,
        timestamp: new Date(),
      });
    },
  },
  {
    name: '/session',
    description: text.cli.commandSessions,
    getSuggestions: async ({ sessionManager }) => {
      const sessions = await sessionManager.listSessions();
      return sessions.map((s) => ({
        name: s.id.slice(0, 8),
        description: `${s.name} (${new Date(s.updatedAt).toLocaleDateString()})`,
      }));
    },
    execute: async ({ emit, sessionManager, input }) => {
      const args = input.trim().split(/\s+/).slice(1);
      if (args.length > 0) {
        const sessionId = args[0];
        try {
          await sessionManager.resumeSession(sessionId);
          emit({
            type: 'log',
            level: 'info',
            message: `Switched to session: ${sessionId}`,
            timestamp: new Date(),
          });
        } catch (error: any) {
          emit({
            type: 'log',
            level: 'error',
            message: `Failed to switch session: ${error.message}`,
            timestamp: new Date(),
          });
        }
        return;
      }

      const sessions = await sessionManager.listSessions();
      if (sessions.length === 0) {
        emit({
          type: 'log',
          level: 'info',
          message: text.cli.noSessionsFound,
          timestamp: new Date(),
        });
        return;
      }
      emit({
        type: 'log',
        level: 'info',
        message: 'Type "/session " (with a space) to select a session from the interactive list.',
        timestamp: new Date(),
      });
    },
  },
  {
    name: '/snapshot',
    description: 'Manage repository snapshots (list, create, delete, restore)',
    getSuggestions: async ({ sessionManager, input }) => {
      const trimmed = input.trimStart();
      const isSpaceTrailing = input.endsWith(' ');
      const parts = trimmed.split(/\s+/);
      const subCommands = ['list', 'create', 'delete', 'restore'];

      // Level 1: Sub-command suggestions
      if (parts.length === 1 || (parts.length === 2 && !isSpaceTrailing)) {
        const search = parts[1] || '';
        return subCommands
          .filter((s) => s.startsWith(search))
          .map((s) => ({ name: s, description: `Snapshot ${s} command` }));
      }

      // Level 2: Data suggestions (hashes)
      if (parts.length >= 2 && isSpaceTrailing) {
        const subAction = parts[1].toLowerCase();
        if (['restore', 'delete', 'list'].includes(subAction)) {
          const manager = new CheckpointManager();
          const repoPath = sessionManager.getCurrent().meta.repoPath;
          const snapshots = await manager.listSnapshots(repoPath);
          const search = parts[2] || '';
          return snapshots
            .filter((s) => s.hash.startsWith(search))
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
      } else if (subCommand === 'create') {
        const message = args.slice(1).join(' ') || 'Manual snapshot';
        const result = await manager.createSafeSnapshot(repoPath, [], message);
        emit({
          type: 'log',
          level: 'info',
          message: `Snapshot created: ${result.commitHash.slice(0, 7)}`,
          timestamp: new Date(),
        });
      } else if (subCommand === 'delete') {
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
      } else if (subCommand === 'restore') {
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
        // 🔴 触发挑战-响应拦截器
        return {
          action: 'NEED_CONFIRMATION',
          message: `Restore will overwrite your current workspace.`,
          data: {
            command: '/snapshot',
            args: ['restore', hash],
            challenge: hash.slice(0, 6), // 必须输入 Hash 的前 6 位
          },
        };
      } else {
        emit({
          type: 'log',
          level: 'error',
          message: 'Unknown subcommand. Use list, create, delete, or restore.',
          timestamp: new Date(),
        });
      }
    },
  },
];

export async function getSuggestions(
  input: string,
  context: CommandContext,
): Promise<{ name: string; description: string }[]> {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return [];

  const parts = trimmed.split(/\s+/);
  const commandName = parts[0].toLowerCase();
  const exactMatch = commands.find((c) => c.name.toLowerCase() === commandName);

  // If we have an exact command match, or we're typing arguments, show sub-suggestions
  if (parts.length > 1 || input.endsWith(' ')) {
    if (exactMatch?.getSuggestions) {
      // Only provide suggestions for the first argument level.
      // parts.length === 1 means we just typed the command (no space yet, but input.endsWith(' ') might be false).
      // parts.length === 2 means we are typing the first argument (possibly empty if just typed a space).
      // If we have a second argument (parts.length > 2), stop suggesting.
      // Only provide suggestions for up to 2 argument levels.
      // parts.length === 1: command name
      // parts.length === 2: first argument (e.g. subcommand)
      // parts.length === 3: second argument (e.g. hash)
      if (parts.length > 3) {
        return [];
      }
      return await exactMatch.getSuggestions(context);
    }
    return [];
  }

  // Otherwise, suggest commands
  const search = commandName;
  return commands
    .filter((c) => c.name.toLowerCase().startsWith(search))
    .map((c) => ({ name: c.name, description: c.description }));
}

export function findCommand(input: string): Command | undefined {
  const firstWord = input.trim().split(/\s+/)[0].toLowerCase();
  return commands.find((c) => c.name.toLowerCase() === firstWord);
}
