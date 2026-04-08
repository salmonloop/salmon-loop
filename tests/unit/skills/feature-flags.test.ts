import { afterEach, describe, expect, it } from 'bun:test';

import { getSkillFeatureFlags } from '../../../src/core/skills/feature-flags.js';

describe('getSkillFeatureFlags', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBridge = process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalBridge === undefined) {
      delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
    } else {
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = originalBridge;
    }
  });

  it('defaults bridgeDisabled to false in development', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;

    expect(getSkillFeatureFlags().bridgeDisabled).toBe(false);
  });

  it('defaults bridgeDisabled to true outside development', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;

    expect(getSkillFeatureFlags().bridgeDisabled).toBe(true);
  });

  it('respects explicit env override', () => {
    process.env.NODE_ENV = 'development';
    process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = 'true';

    expect(getSkillFeatureFlags().bridgeDisabled).toBe(true);
  });
});
