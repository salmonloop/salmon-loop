import { text } from '../locales/index.js';

import { Command } from './types.js';

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
    execute: async ({ emit, sessionManager }) => {
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
      const header = text.cli.sessionsHeader;
      const list = sessions
        .map(
          (s) =>
            `${s.id.slice(0, 8)} | ${s.name.padEnd(20)} | ${new Date(s.updatedAt).toLocaleString()}`,
        )
        .join('\n');
      emit({
        type: 'log',
        level: 'info',
        message: `${header}\n${list}`,
        timestamp: new Date(),
      });
    },
  },
];

export function getSuggestions(input: string): Command[] {
  if (!input.startsWith('/')) return [];
  const search = input.toLowerCase();
  return commands.filter((c) => c.name.toLowerCase().startsWith(search));
}

export function findCommand(input: string): Command | undefined {
  const firstWord = input.trim().split(/\s+/)[0].toLowerCase();
  return commands.find((c) => c.name.toLowerCase() === firstWord);
}
