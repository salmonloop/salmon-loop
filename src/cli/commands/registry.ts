import { authCommand } from './auth.js';
import { exitCommand, quitCommand } from './exit.js';
import { newCommand } from './new.js';
import { parallelCommand } from './parallel.js';
import { queueCommand } from './queue.js';
import { sessionCommand } from './session.js';
import { snapshotInteractiveCommand } from './snapshot-interactive.js';
import { statusCommand } from './status.js';
import type { Command, CommandContext } from './types.js';
import { parseSuggestionContext } from './utils.js';

export const commands: Command[] = [
  exitCommand,
  quitCommand,
  statusCommand,
  queueCommand,
  authCommand,
  parallelCommand,
  newCommand,
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
  sessionCommand,
  snapshotInteractiveCommand,
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
