import { describe, expect, it, mock } from 'bun:test';

import { configCommand } from '../../../../src/cli/commands/config.js';
import { snapshotInteractiveCommand } from '../../../../src/cli/commands/snapshot-interactive.js';
import { createCliSlashRuntime } from '../../../../src/cli/slash/runtime.js';

mock.module('../../../../src/core/skills/loader.js', () => {
  return {
    SkillLoader: mock().mockImplementation(() => ({
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
    expect(names).toContain('mode');
    expect(names).toContain('log-mode');
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
