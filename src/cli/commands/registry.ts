import { text } from '../../locales/index.js';

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
];

export function getSuggestions(input: string): Command[] {
  if (!input.startsWith('/')) return [];
  return commands.filter((c) => c.name.startsWith(input));
}

export function findCommand(input: string): Command | undefined {
  return commands.find((c) => c.name === input.split(' ')[0]);
}
