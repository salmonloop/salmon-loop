import { describe, it, expect } from 'vitest';

import { findCommand, getSuggestions } from '../../../../src/cli/commands/registry.js';

describe('CLI Command Registry', () => {
  describe('findCommand', () => {
    it('should find registered commands', () => {
      const cmd = findCommand('/help');
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe('/help');
    });

    it('should be case-insensitive', () => {
      const cmd = findCommand('/HELP');
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe('/help');
    });

    it('should handle leading/trailing spaces', () => {
      const cmd = findCommand('  /status  ');
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe('/status');
    });

    it('should return undefined for unknown commands', () => {
      const cmd = findCommand('/unknown');
      expect(cmd).toBeUndefined();
    });

    it('should not match partial words', () => {
      // /exit should not match /exitter
      const cmd = findCommand('/exitter');
      expect(cmd).toBeUndefined();
    });
  });

  describe('getSuggestions', () => {
    const mockContext = {
      emit: () => {},
      sessionManager: {} as any,
      input: '',
    };

    it('should return matches for prefix', async () => {
      const matches = await getSuggestions('/h', { ...mockContext, input: '/h' });
      expect(matches.map((m: any) => m.name)).toContain('/help');
      expect(matches.map((m: any) => m.name)).toContain('/history');
    });

    it('should be case-insensitive for suggestions', async () => {
      const matches = await getSuggestions('/H', { ...mockContext, input: '/H' });
      expect(matches.map((m: any) => m.name)).toContain('/help');
    });

    it('should return empty array if not starting with /', async () => {
      expect(await getSuggestions('help', { ...mockContext, input: 'help' })).toEqual([]);
    });
  });
});
