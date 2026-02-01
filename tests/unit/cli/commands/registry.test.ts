import { describe, it, expect } from 'vitest';

import { findCommand, getSuggestions } from '../../../../src/cli/commands/registry.js';
import { Command } from '../../../../src/cli/commands/types.js';

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
    it('should return matches for prefix', () => {
      const matches = getSuggestions('/h');
      expect(matches.map((m: Command) => m.name)).toContain('/help');
      expect(matches.map((m: Command) => m.name)).toContain('/history');
    });

    it('should be case-insensitive for suggestions', () => {
      const matches = getSuggestions('/H');
      expect(matches.map((m: Command) => m.name)).toContain('/help');
    });

    it('should return empty array if not starting with /', () => {
      expect(getSuggestions('help')).toEqual([]);
    });
  });
});
