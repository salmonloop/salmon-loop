import type { Command, CommandContext } from './types.js';
import { parseSuggestionContext } from './utils.js';

function findSubcommand(root: Command, name: string): Command | undefined {
  const needle = name.trim().toLowerCase();
  if (!needle) return undefined;
  return (root.subcommands ?? []).find((c) => {
    if (c.name.toLowerCase() === needle) return true;
    return (c.aliases ?? []).some((a) => a.toLowerCase() === needle);
  });
}

/**
 * Default subcommand suggestions for commands that expose `subcommands` but do not define a
 * top-level `getSuggestions`. This keeps completion behavior consistent across the slash runtime.
 */
export async function suggestSubcommands(
  root: Command,
  context: CommandContext,
): Promise<Array<{ name: string; description: string; command?: Command }>> {
  const subcommands = root.subcommands ?? [];
  if (subcommands.length === 0) return [];

  const { argIndex, currentPrefix } = parseSuggestionContext(context.input);

  // Suggest subcommand names at the first argument slot:
  // "/config " -> ["log", ...]
  // "/config l" -> ["log", ...]
  if (argIndex === 1) {
    const search = currentPrefix.toLowerCase();
    return subcommands
      .filter((c) => c.name.toLowerCase().startsWith(search))
      .map((c) => ({ name: c.name, description: c.description, command: c }));
  }

  // Delegate to the subcommand for deeper suggestions:
  // "/config log " -> delegate to "log" subcommand (argIndex >= 2)
  if (argIndex > 1) {
    const tokens = context.input.trim().split(/\s+/);
    const subName = tokens[1] || '';
    const sub = findSubcommand(root, subName);
    if (!sub?.getSuggestions) return [];
    return await sub.getSuggestions(context);
  }

  return [];
}
