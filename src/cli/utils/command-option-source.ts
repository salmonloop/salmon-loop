import type { Command } from 'commander';

export function getOptionValueSourceWithGlobalFallback(command: Command, optionName: string) {
  if (typeof command.getOptionValueSource === 'function') {
    const direct = command.getOptionValueSource(optionName);
    if (direct) return direct;
  }

  const parent = command.parent;
  if (parent && typeof parent.getOptionValueSource === 'function') {
    return parent.getOptionValueSource(optionName);
  }

  return undefined;
}
