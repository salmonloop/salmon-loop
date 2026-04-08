/**
 * Unit tests for the centralized skill feature flags module.
 *
 * Validates: Requirements 11.4
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { getSkillFeatureFlags, type SkillFeatureFlags } from '../../../src/core/skills/feature-flags.js';

describe('getSkillFeatureFlags()', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const envKeys = [
    'SALMONLOOP_SKILL_PARSER_STRICT',
    'SALMONLOOP_SKILL_LEGACY_DIRECT_MD',
    'SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC',
    'NODE_ENV',
  ];

  beforeEach(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  // -----------------------------------------------------------------------
  // parserStrict
  // -----------------------------------------------------------------------
  describe('parserStrict', () => {
    it('defaults to true when env var is not set', () => {
      expect(getSkillFeatureFlags().parserStrict).toBe(true);
    });

    it('returns true when env var is "true"', () => {
      process.env.SALMONLOOP_SKILL_PARSER_STRICT = 'true';
      expect(getSkillFeatureFlags().parserStrict).toBe(true);
    });

    it('returns true when env var is "1"', () => {
      process.env.SALMONLOOP_SKILL_PARSER_STRICT = '1';
      expect(getSkillFeatureFlags().parserStrict).toBe(true);
    });

    it('returns false when env var is "false"', () => {
      process.env.SALMONLOOP_SKILL_PARSER_STRICT = 'false';
      expect(getSkillFeatureFlags().parserStrict).toBe(false);
    });

    it('returns false when env var is "0"', () => {
      process.env.SALMONLOOP_SKILL_PARSER_STRICT = '0';
      expect(getSkillFeatureFlags().parserStrict).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // legacyDirectMd
  // -----------------------------------------------------------------------
  describe('legacyDirectMd', () => {
    it('defaults to false when env var is not set', () => {
      expect(getSkillFeatureFlags().legacyDirectMd).toBe(false);
    });

    it('returns true when env var is "true"', () => {
      process.env.SALMONLOOP_SKILL_LEGACY_DIRECT_MD = 'true';
      expect(getSkillFeatureFlags().legacyDirectMd).toBe(true);
    });

    it('returns true when env var is "1"', () => {
      process.env.SALMONLOOP_SKILL_LEGACY_DIRECT_MD = '1';
      expect(getSkillFeatureFlags().legacyDirectMd).toBe(true);
    });

    it('returns false when env var is "false"', () => {
      process.env.SALMONLOOP_SKILL_LEGACY_DIRECT_MD = 'false';
      expect(getSkillFeatureFlags().legacyDirectMd).toBe(false);
    });

    it('returns false when env var is "0"', () => {
      process.env.SALMONLOOP_SKILL_LEGACY_DIRECT_MD = '0';
      expect(getSkillFeatureFlags().legacyDirectMd).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // bridgeDisabled
  // -----------------------------------------------------------------------
  describe('bridgeDisabled', () => {
    it('defaults to true (disabled) when NODE_ENV is not set', () => {
      expect(getSkillFeatureFlags().bridgeDisabled).toBe(true);
    });

    it('defaults to false (enabled) in development', () => {
      process.env.NODE_ENV = 'development';
      expect(getSkillFeatureFlags().bridgeDisabled).toBe(false);
    });

    it('defaults to true (disabled) in production', () => {
      process.env.NODE_ENV = 'production';
      expect(getSkillFeatureFlags().bridgeDisabled).toBe(true);
    });

    it('returns true when env var is "true" regardless of NODE_ENV', () => {
      process.env.NODE_ENV = 'development';
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = 'true';
      expect(getSkillFeatureFlags().bridgeDisabled).toBe(true);
    });

    it('returns false when env var is "false" regardless of NODE_ENV', () => {
      process.env.NODE_ENV = 'production';
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = 'false';
      expect(getSkillFeatureFlags().bridgeDisabled).toBe(false);
    });

    it('returns false when env var is "0" in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = '0';
      expect(getSkillFeatureFlags().bridgeDisabled).toBe(false);
    });

    it('returns true when env var is "1" in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = '1';
      expect(getSkillFeatureFlags().bridgeDisabled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Snapshot consistency
  // -----------------------------------------------------------------------
  describe('return type', () => {
    it('returns an object with all three flags', () => {
      const flags: SkillFeatureFlags = getSkillFeatureFlags();
      expect(typeof flags.parserStrict).toBe('boolean');
      expect(typeof flags.legacyDirectMd).toBe('boolean');
      expect(typeof flags.bridgeDisabled).toBe('boolean');
    });

    it('reflects env changes between calls (no caching)', () => {
      process.env.SALMONLOOP_SKILL_PARSER_STRICT = 'false';
      expect(getSkillFeatureFlags().parserStrict).toBe(false);

      process.env.SALMONLOOP_SKILL_PARSER_STRICT = 'true';
      expect(getSkillFeatureFlags().parserStrict).toBe(true);
    });
  });
});
