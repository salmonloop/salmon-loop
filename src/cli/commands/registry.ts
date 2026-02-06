import { authCommand } from './auth.js';
import { exitCommand } from './exit.js';
import { newCommand } from './new.js';
import { queueCommand } from './queue.js';
import { sessionCommand } from './session.js';
import { snapshotInteractiveCommand } from './snapshot-interactive.js';
import { statusCommand } from './status.js';
import { subAgentCommand } from './subagent.js';
import type { Command, CommandContext } from './types.js';
import { parseSuggestionContext } from './utils.js';

const baseCommands: Command[] = [
  exitCommand,
  statusCommand,
  queueCommand,
  authCommand,
  subAgentCommand,
  newCommand,
  {
    name: '/help',
    description: 'Show available commands',
    order: 80,
    execute: ({ emit }) => {
      const visible = commands.filter((c) => !c.hidden);
      const maxName = Math.max(...visible.map((cmd) => cmd.name.length), 0);
      const rows = visible.map((cmd) => {
        const paddedName = `${cmd.name}`.padEnd(maxName + 2);
        return `${paddedName}${cmd.description}`;
      });
      const helpMsg = rows.join('\n');
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

export const commands: Command[] = [...baseCommands].sort(
  (a, b) => (a.order ?? 0) - (b.order ?? 0),
);

function getCommandNames(command: Command): string[] {
  return [
    command.name.toLowerCase(),
    ...(command.aliases?.map((alias) => alias.toLowerCase()) ?? []),
  ];
}

export async function getSuggestions(
  input: string,
  context: CommandContext,
): Promise<{ name: string; description: string }[]> {
  const { argIndex, currentPrefix } = parseSuggestionContext(input);

  if (!input.trimStart().startsWith('/')) return [];

  const commandName = input.trimStart().split(/\s+/)[0].toLowerCase();
  const exactMatch = commands.find((c) => getCommandNames(c).includes(commandName));

  // If we have an exact command match and we are in the argument area
  if (exactMatch && argIndex > 0) {
    return exactMatch.getSuggestions ? await exactMatch.getSuggestions(context) : [];
  }

  // Otherwise, suggest base commands
  const search = currentPrefix.toLowerCase();
  const matches = commands.filter(
    (c) => !c.hidden && getCommandNames(c).some((n) => n.startsWith(search)),
  );
  const maxNameLength = matches.reduce((max, cmdItem) => Math.max(max, cmdItem.name.length), 0);
  return matches.map((c) => ({
    name: `${c.name}`.padEnd(maxNameLength + 2),
    description: c.description,
  }));
}

export function findCommand(input: string): Command | undefined {
  const firstWord = input.trim().split(/\s+/)[0].toLowerCase();
  return commands.find((c) => getCommandNames(c).includes(firstWord));
}
