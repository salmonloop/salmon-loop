import { text } from '../locales/index.js';

import { Command, CommandContext } from './types.js';

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
    name: '/history',
    description: text.cli.commandHistory,
    execute: ({ emit, sessionManager }) => {
      const session = sessionManager.getCurrent();
      session.iterations.forEach((iter: any, i: number) => {
        const status = iter.error ? '✗' : '✓';
        emit({
          type: 'log',
          level: 'info',
          message: `#${i + 1} ${status} - ${iter.contextSummary || 'No context'}`,
          timestamp: new Date(),
        });
      });
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
    name: '/sessions',
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
        message: 'Type "/sessions " (with a space) to select a session from the interactive list.',
        timestamp: new Date(),
      });
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
      // parts.length === 1 means we just typed the command and a space.
      // parts.length === 2 means we are typing the first argument.
      // If we have a second argument (parts.length > 2) or we just finished the first (length 2 + space), stop suggesting.
      if (parts.length > 2 || (parts.length === 2 && input.endsWith(' '))) {
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
