import { describe, expect, it, mock } from 'bun:test';

// Mock external dependencies to ensure isolation
mock.module('../../../../src/core/strata/checkpoint/manager.js', () => ({
  CheckpointManager: mock().mockImplementation(() => ({
    listSnapshots: mock().mockResolvedValue([
      { hash: 'abcdef123456', message: 'First Snapshot' },
      { hash: '789012345678', message: 'Second Snapshot' },
    ]),
  })),
}));

describe('CLI Command Registry: Strict Logic Guard', () => {
  async function loadRegistry() {
    return await import('../../../../src/cli/commands/registry.js');
  }

  describe('findCommand (Case & Space Robustness)', () => {
    it('should find command with exact match', async () => {
      const { findCommand } = await loadRegistry();
      const cmd = findCommand('/help');
      expect(cmd?.name).toBe('/help');
    });

    it('should be case-insensitive', async () => {
      const { findCommand } = await loadRegistry();
      expect(findCommand('/HELP')?.name).toBe('/help');
      expect(findCommand('/stAtUs')?.name).toBe('/status');
    });

    it('should trim leading/trailing whitespace', async () => {
      const { findCommand } = await loadRegistry();
      expect(findCommand('   /status   ')?.name).toBe('/status');
    });

    it('should not match partial command names', async () => {
      const { findCommand } = await loadRegistry();
      expect(findCommand('/exitter')).toBeUndefined();
    });

    it('should expose /mode', async () => {
      const { findCommand } = await loadRegistry();
      expect(findCommand('/mode')?.name).toBe('/mode');
    });

    it('should expose /log-mode', async () => {
      const { findCommand } = await loadRegistry();
      expect(findCommand('/log-mode')?.name).toBe('/log-mode');
    });
  });

  describe('getSuggestions (Multi-Level Engine)', () => {
    const mockSessionManager = {
      listSessions: mock().mockResolvedValue([
        { id: 'session-unique-id', name: 'Dev Project', updatedAt: new Date().toISOString() },
        { id: 'abc-xyz-123', name: 'Test Suite', updatedAt: new Date().toISOString() },
      ]),
      getCurrent: mock().mockReturnValue({ meta: { repoPath: '/test-repo' } }),
    };

    const mockContext = {
      emit: mock(),
      sessionManager: mockSessionManager as any,
      input: '',
      dispatch: mock(),
    };

    describe('Level 0: Command Suggestions', () => {
      it('should suggest commands based on prefix', async () => {
        const { getSuggestions } = await loadRegistry();
        const matches = await getSuggestions('/se', { ...mockContext, input: '/se' });
        expect(matches.map((m: any) => m.name.trimEnd())).toContain('/session');
      });

      it('should suggest commands case-insensitively', async () => {
        const { getSuggestions } = await loadRegistry();
        const matches = await getSuggestions('/S', { ...mockContext, input: '/S' });
        const names = matches.map((m: any) => m.name.trimEnd());
        expect(names).toContain('/session');
        expect(names).toContain('/status');
      });

      it('should return empty array if not starting with /', async () => {
        const { getSuggestions } = await loadRegistry();
        expect(await getSuggestions('help', { ...mockContext, input: 'help' })).toEqual([]);
      });
    });

    describe('Level 1: Parameter Suggestions (argIndex=1)', () => {
      it('should trigger session list immediately after space', async () => {
        const { getSuggestions } = await loadRegistry();
        const input = '/session ';
        const matches = await getSuggestions(input, { ...mockContext, input });
        expect(matches.length).toBe(2);
        // ID should be sliced to 8
        expect(matches.map((m: any) => m.name)).toContain('session-');
      });

      it('should filter session list by prefix', async () => {
        const { getSuggestions } = await loadRegistry();
        const input = '/session a';
        const matches = await getSuggestions(input, { ...mockContext, input });
        expect(matches.length).toBe(1);
        expect(matches[0].name).toBe('abc-xyz-');
      });

      it('should suggest subcommands for /snapshot', async () => {
        const { getSuggestions } = await loadRegistry();
        const input = '/snapshot ';
        const matches = await getSuggestions(input, { ...mockContext, input });
        const names = matches.map((m: any) => m.name);
        expect(names).toEqual(['list', 'create', 'delete', 'restore']);
      });
    });

    describe('Level 2: Deep Parameter Suggestions (argIndex=2)', () => {
      it('should suggest snapshot hashes for /snapshot restore', async () => {
        const { getSuggestions } = await loadRegistry();
        const input = '/snapshot restore ';
        const matches = await getSuggestions(input, { ...mockContext, input });
        expect(matches.length).toBe(2);
        expect(matches[0].name).toBe('abcdef1'); // .slice(0, 7)
        expect(matches[1].name).toBe('7890123');
      });

      it('should filter snapshot hashes by prefix', async () => {
        const { getSuggestions } = await loadRegistry();
        const input = '/snapshot delete 7';
        const matches = await getSuggestions(input, { ...mockContext, input });
        expect(matches.length).toBe(1);
        expect(matches[0].name).toBe('7890123');
      });
    });

    describe('Strict Stop Conditions (Anti-Bug Guard)', () => {
      it('should return empty for /session when index > 1', async () => {
        const { getSuggestions } = await loadRegistry();
        const input = '/session some-id extra-args ';
        const matches = await getSuggestions(input, { ...mockContext, input });
        expect(matches).toEqual([]);
      });

      it('should return empty for unknown subcommands', async () => {
        const { getSuggestions } = await loadRegistry();
        const input = '/snapshot unknown-action ';
        const matches = await getSuggestions(input, { ...mockContext, input });
        expect(matches).toEqual([]);
      });

      it('should handle extreme whitespace scenarios', async () => {
        const { getSuggestions } = await loadRegistry();
        const input = '   /snapshot    restore      ';
        const matches = await getSuggestions(input, { ...mockContext, input });
        expect(matches.length).toBe(2);
        expect(matches[0].name).toBe('abcdef1');
      });
    });
  });
});
