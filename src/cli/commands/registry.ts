import { CheckpointManager } from '../../core/strata/checkpoint/manager.js';
import { text } from '../locales/index.js';

import { Command, CommandContext, CommandResult } from './types.js';

/**
 * Parses input to provide a structured context for suggestions.
 */
function parseSuggestionContext(input: string) {
  const trimmed = input.trimStart();
  const parts = trimmed.split(/\s+/);

  // argIndex always points to the current argument slot being filled
  // e.g., "/session " splits to ["/session", ""], argIndex is 1.
  const argIndex = parts.length - 1;
  const currentPrefix = parts[argIndex] || '';
  const isSpaceTrailing = input.endsWith(' ');

  return { argIndex, currentPrefix, isSpaceTrailing };
}

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
    getSuggestions: async ({ sessionManager, input }) => {
      const { argIndex, currentPrefix } = parseSuggestionContext(input);

      // Level 1: Suggest sessions
      if (argIndex === 1) {
        const sessions = await sessionManager.listSessions();
        const search = currentPrefix.toLowerCase();
        return sessions
          .filter(
            (s) => s.id.toLowerCase().startsWith(search) || s.name.toLowerCase().includes(search),
          )
          .map((s) => ({
            name: s.id.slice(0, 8),
            description: `${s.name} (${new Date(s.updatedAt).toLocaleDateString()})`,
          }));
      }

      return [];
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
  const { argIndex, currentPrefix } = parseSuggestionContext(input);

  if (!input.trimStart().startsWith('/')) return [];

  const commandName = input.trimStart().split(/\s+/)[0].toLowerCase();
  const exactMatch = commands.find((c) => c.name.toLowerCase() === commandName);

  // If we have an exact command match and we are in the argument area
  if (exactMatch && argIndex > 0) {
    return exactMatch.getSuggestions ? await exactMatch.getSuggestions(context) : [];
  }

  // Otherwise, suggest base commands
  const search = currentPrefix.toLowerCase();
  return commands
    .filter((c) => c.name.toLowerCase().startsWith(search))
    .map((c) => ({ name: c.name, description: c.description }));
}

export function findCommand(input: string): Command | undefined {
  const firstWord = input.trim().split(/\s+/)[0].toLowerCase();
  return commands.find((c) => c.name.toLowerCase() === firstWord);
}
