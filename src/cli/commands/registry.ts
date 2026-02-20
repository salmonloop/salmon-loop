import { allowlistCommand } from './allowlist.js';
import { configCommand } from './config.js';
import { exitCommand } from './exit.js';
import { llmOutputCommand } from './llm-output.js';
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
  allowlistCommand,
  configCommand,
  subAgentCommand,
  newCommand,
  llmOutputCommand,
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
): Promise<{ name: string; description: string; command?: Command }[]> {
  const { argIndex, currentPrefix } = parseSuggestionContext(input);

  if (!input.trimStart().startsWith('/')) return [];

  const commandName = input.trimStart().split(/\s+/)[0].toLowerCase();
  const exactMatch = commands.find((c) => getCommandNames(c).includes(commandName));

  // If we have an exact command match and we are in the argument area
  if (exactMatch && argIndex > 0) {
    if (argIndex === 1 && exactMatch.subcommands) {
      // Subcommand logic
      const subSearch = currentPrefix.toLowerCase();
      const subMatches = exactMatch.subcommands.filter((s) => s.name.startsWith(subSearch));
      return subMatches.map((s) => ({
        name: s.name,
        description: s.description,
        command: s,
      }));
    }

    // If we have an exact subcommand match at argIndex 1, delegate to it for argIndex > 1
    if (argIndex > 1 && exactMatch.subcommands) {
      const args = input.trim().split(/\s+/);
      const subCmdName = args[1].toLowerCase();
      const subMatch = exactMatch.subcommands.find((s) => s.name === subCmdName);
      if (subMatch?.getSuggestions) {
        return subMatch.getSuggestions(context);
      }
    }

    return exactMatch.getSuggestions ? await exactMatch.getSuggestions(context) : [];
  }

  // Otherwise, suggest base commands
  const search = currentPrefix.toLowerCase();
  const matches = commands.filter(
    (c) => !c.hidden && getCommandNames(c).some((n) => n.startsWith(search)),
  );
  const maxNameLength = matches.reduce((max, cmdItem) => Math.max(max, cmdItem.name.length), 0);
  return matches.map((c) => ({
    name: c.name.padEnd(maxNameLength + 2),
    description: c.description,
    command: c,
  }));
}

export function findCommand(input: string): Command | undefined {
  const firstWord = input.trim().split(/\s+/)[0].toLowerCase();
  return commands.find((c) => getCommandNames(c).includes(firstWord));
}
