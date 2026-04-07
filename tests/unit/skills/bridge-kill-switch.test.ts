import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import {
  clearAuditTrail,
  getAuditTrail,
} from '../../../src/core/observability/audit-trail.js';
import {
  createLogger,
  setLogger,
  tryGetLogger,
} from '../../../src/core/observability/logger.js';
import {
  isBridgeSkillExecDisabled,
  skillToToolSpec,
} from '../../../src/core/skills/bridge.js';
import type { Skill } from '../../../src/core/skills/types.js';
import type { ToolRuntimeCtx } from '../../../src/core/tools/types.js';

function createMockSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'test-skill',
    path: '/fake/path/test-skill/SKILL.md',
    rawContent: '',
    instructions: '',
    metadata: {
      name: 'test-skill',
      description: 'A test skill',
    },
    ...overrides,
  } as Skill;
}

function createMockCtx(): ToolRuntimeCtx {
  return {
    repoRoot: '/fake/repo',
    attemptId: 1,
    dryRun: false,
  };
}

describe('Bridge kill-switch (Unit)', () => {
  const originalEnv = process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    clearAuditTrail();
    delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
    if (!tryGetLogger()) {
      setLogger(createLogger({ silent: true }));
    }
  });

  afterEach(() => {
    clearAuditTrail();
    if (originalEnv === undefined) {
      delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
    } else {
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = originalEnv;
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  describe('isBridgeSkillExecDisabled', () => {
    // --- Explicit env var overrides ---

    it('returns true when env var is "true"', () => {
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = 'true';
      expect(isBridgeSkillExecDisabled()).toBe(true);
    });

    it('returns true when env var is "1"', () => {
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = '1';
      expect(isBridgeSkillExecDisabled()).toBe(true);
    });

    it('returns false when env var is "false" even in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = 'false';
      expect(isBridgeSkillExecDisabled()).toBe(false);
    });

    it('returns false when env var is "0" even in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = '0';
      expect(isBridgeSkillExecDisabled()).toBe(false);
    });

    // --- NODE_ENV defaults when env var is not set ---

    it('returns false (bridge enabled) in development when env var is not set', () => {
      delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
      process.env.NODE_ENV = 'development';
      expect(isBridgeSkillExecDisabled()).toBe(false);
    });

    it('returns true (bridge disabled) in production when env var is not set', () => {
      delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
      process.env.NODE_ENV = 'production';
      expect(isBridgeSkillExecDisabled()).toBe(true);
    });

    it('returns true (bridge disabled) in test when env var is not set', () => {
      delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
      process.env.NODE_ENV = 'test';
      expect(isBridgeSkillExecDisabled()).toBe(true);
    });

    it('returns true (bridge disabled) when NODE_ENV is not set', () => {
      delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
      delete process.env.NODE_ENV;
      expect(isBridgeSkillExecDisabled()).toBe(true);
    });

    it('returns true (bridge disabled) when env var is empty string in non-dev', () => {
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = '';
      process.env.NODE_ENV = 'production';
      expect(isBridgeSkillExecDisabled()).toBe(true);
    });

    it('returns false when env var is empty string in development', () => {
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = '';
      process.env.NODE_ENV = 'development';
      expect(isBridgeSkillExecDisabled()).toBe(false);
    });
  });

  describe('skillToToolSpec executor with kill-switch', () => {
    it('returns DENIED status when kill-switch is active', async () => {
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = 'true';

      const skill = createMockSkill();
      const spec = skillToToolSpec(skill, { router: null as any });
      const result = await spec.executor({ args: 'hello' }, createMockCtx());

      expect(result).toEqual({ prompt: '', status: 'DENIED' });
    });

    it('emits SKILL_EXECUTION_DENIED audit event when kill-switch is active', async () => {
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = '1';

      const skill = createMockSkill({ id: 'my-blocked-skill' });
      const spec = skillToToolSpec(skill, { router: null as any });
      await spec.executor({ args: 'test-args' }, createMockCtx());

      const trail = getAuditTrail();
      expect(trail.length).toBe(1);
      expect(trail[0].action).toBe('SKILL_EXECUTION_DENIED');
      expect(trail[0].details).toMatchObject({
        skillId: 'my-blocked-skill',
        route: 'tool-bridge',
        denyReason: 'BRIDGE_KILL_SWITCH',
        denySource: 'env:SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC',
      });
      expect(trail[0].severity).toBe('high');
    });

    it('does not call executeSkill when kill-switch is active', async () => {
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = 'true';

      const skill = createMockSkill();
      // Pass null as toolRouter — if executeSkill were called, it would throw
      const spec = skillToToolSpec(skill, { router: null as any });
      const result = await spec.executor({ args: '' }, createMockCtx());

      // If we got here without error, executeSkill was not called
      expect(result.status).toBe('DENIED');
    });
  });
});

