import type {
  SlashCommandSpec,
  SlashRegistry,
  SlashRegistryDiagnostics,
  SlashSuggestionItem,
} from './types.js';

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeCommandName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed.startsWith('/')) return `/${trimmed}`.toLowerCase();
  return trimmed.toLowerCase();
}

export interface CreateSlashRegistryOptions {
  commands: SlashCommandSpec[];
  // When conflicts happen, keep the first-registered command and drop later ones.
  conflictPolicy?: 'keep_first';
}

export function createSlashRegistry(options: CreateSlashRegistryOptions): SlashRegistry {
  const conflictPolicy = options.conflictPolicy ?? 'keep_first';
  if (conflictPolicy !== 'keep_first') {
    throw new Error(`Unsupported conflictPolicy: ${conflictPolicy}`);
  }

  const diagnostics: SlashRegistryDiagnostics = { conflicts: [] };

  const ordered = [...options.commands].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const byName = new Map<string, SlashCommandSpec>();
  const byToken = new Map<string, SlashCommandSpec>();

  const tryRegisterToken = (token: string, spec: SlashCommandSpec, reason: 'name' | 'alias') => {
    const normalized = normalizeToken(token);
    const existing = byToken.get(normalized);
    if (existing) {
      diagnostics.conflicts.push({
        existing: existing.name,
        incoming: spec.name,
        reason,
        token: normalized,
      });
      return false;
    }
    byToken.set(normalized, spec);
    return true;
  };

  for (const command of ordered) {
    const normalizedName = normalizeCommandName(command.name);
    const spec: SlashCommandSpec = { ...command, name: normalizedName };

    // If the primary name conflicts, drop the command.
    if (!tryRegisterToken(spec.name, spec, 'name')) {
      continue;
    }

    // Only register aliases if the primary name succeeded.
    for (const alias of spec.aliases ?? []) {
      const normalizedAlias = normalizeCommandName(alias);
      if (!tryRegisterToken(normalizedAlias, spec, 'alias')) {
        // Alias conflict does not drop the command; it only drops that alias.
        continue;
      }
    }

    byName.set(spec.name, spec);
  }

  const listAll = () => Array.from(byName.values()).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const suggest = (prefix: string): SlashSuggestionItem[] => {
    const normalizedPrefix = normalizeCommandName(prefix || '/');
    const commands = listAll().filter((c) => !c.hidden);
    const matches = commands.filter((c) => {
      const tokens = [c.name, ...(c.aliases?.map(normalizeCommandName) ?? [])];
      return tokens.some((t) => t.startsWith(normalizedPrefix));
    });
    const maxNameLength = matches.reduce((max, cmd) => Math.max(max, cmd.name.length), 0);
    return matches.map((cmd) => ({
      name: cmd.name.padEnd(maxNameLength + 2),
      description: cmd.description,
      hidden: cmd.hidden,
      order: cmd.order,
    }));
  };

  return {
    find: (commandOrAlias: string) => {
      const normalized = normalizeCommandName(commandOrAlias);
      return byToken.get(normalized);
    },
    list: () => listAll(),
    suggest,
    diagnostics: () => diagnostics,
  };
}

export { normalizeCommandName };
