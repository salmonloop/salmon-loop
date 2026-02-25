import { describe, expect, it } from 'bun:test';

import { ensureInSandbox, isPathWithinDirectory } from '../../../src/core/utils/path.js';

describe('path utils', () => {
  describe('isPathWithinDirectory', () => {
    it('returns true for nested paths', () => {
      expect(isPathWithinDirectory('/tmp', '/tmp/s8p-wt/repo')).toBe(true);
    });

    it('returns false for temp-prefix paths that are outside root', () => {
      expect(isPathWithinDirectory('/tmp', '/tmp-evil/worktree')).toBe(false);
    });

    it('returns true for exact root match when allowEqual=true', () => {
      expect(isPathWithinDirectory('/tmp', '/tmp', { allowEqual: true })).toBe(true);
    });

    it('returns false for exact root match when allowEqual=false', () => {
      expect(isPathWithinDirectory('/tmp', '/tmp', { allowEqual: false })).toBe(false);
    });
  });

  describe('ensureInSandbox', () => {
    it('returns normalized target when contained in root', () => {
      expect(ensureInSandbox('/tmp', '/tmp/a/b')).toBe('/tmp/a/b');
    });

    it('throws for temp-prefix lookalike paths outside root', () => {
      expect(() => ensureInSandbox('/tmp', '/tmp-evil/a')).toThrow(/Security Violation/i);
    });
  });
});
