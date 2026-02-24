import { describe, expect, it, vi } from 'bun:test';

import { configCommand } from '../../../../src/cli/commands/config.js';
import { snapshotInteractiveCommand } from '../../../../src/cli/commands/snapshot-interactive.js';
import { createCliSlashRuntime } from '../../../../src/cli/slash/runtime.js';

vi.mock('../../../../src/core/skills/loader.js', () => {
  return {
    SkillLoader: vi.fn().mockImplementation(() => ({
      initialize: async () => [],
    })),
  };
});

describe('CliSlashRuntime suggestions', () => {
  it('suggests subcommands for /config', async () => {
    const runtime = await createCliSlashRuntime({
      repoRoot: process.cwd(),
      baseCommands: [configCommand, snapshotInteractiveCommand],
      emit: () => {},
    });

    const suggestions = await runtime.getSuggestions('/config ', {
      emit: () => {},
      sessionManager: {} as any,
      input: '/config ',
      dispatch: () => {},
    });

    const names = suggestions.map((s) => s.name.trim());
    expect(names).toContain('view');

    const aliasSuggestions = await runtime.getSuggestions('/config l', {
      emit: () => {},
      sessionManager: {} as any,
      input: '/config l',
      dispatch: () => {},
    });
    expect(aliasSuggestions.map((s) => s.name.trim())).toContain('log');
  });

  it('suggests subcommands for /snapshot', async () => {
    const runtime = await createCliSlashRuntime({
      repoRoot: process.cwd(),
      baseCommands: [configCommand, snapshotInteractiveCommand],
      emit: () => {},
    });

    const suggestions = await runtime.getSuggestions('/snapshot ', {
      emit: () => {},
      sessionManager: {} as any,
      input: '/snapshot ',
      dispatch: () => {},
    });

    const names = suggestions.map((s) => s.name.trim());
    expect(names).toContain('list');
    expect(names).toContain('create');
  });
});
