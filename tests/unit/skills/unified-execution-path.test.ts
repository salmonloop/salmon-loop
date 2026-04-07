import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

import {
  clearAuditTrail,
  getAuditTrail,
} from '../../../src/core/observability/audit-trail.js';
import {
  createLogger,
  setLogger,
  tryGetLogger,
} from '../../../src/core/observability/logger.js';
import { skillToToolSpec, type RouterBox } from '../../../src/core/skills/bridge.js';
import { MicroTaskRunner } from '../../../src/core/skills/runtime/MicroTaskRunner.js';
import type { Skill } from '../../../src/core/skills/types.js';
import type { ToolCallEnvelope, ToolResult, ToolRuntimeCtx } from '../../../src/core/tools/types.js';

/**
 * Tests for unified execution path (Task 1.5).
 *
 * Validates: Requirements 1.5, 10.1, 10.2
 *
 * - Property 1: Execution Path Governance — bridge path triggers ToolRouter authorization
 * - Property 2: No Direct Shell Bypass — legacy runner throws in production context
 * - Integration: denied command blocked in both slash and bridge paths
 * - Integration: audit events emitted with correct route field for both paths
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'test-skill',
    path: '/fake/path/test-skill/SKILL.md',
    rawContent: '',
    instructions: '!sh echo hello\nDone: $args',
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

/**
 * Creates a mock ToolRouter that records calls and returns configurable results.
 */
function createMockToolRouter(callResult?: Partial<ToolResult>) {
  const calls: ToolCallEnvelope[] = [];
  const defaultResult: ToolResult = {
    id: 'mock-call',
    toolName: 'shell.exec',
    source: 'builtin',
    status: 'ok',
    output: { ok: true, stdout: 'hello', stderr: '' },
    durationMs: 1,
    ...callResult,
  };

  return {
    calls,
    router: {
      call: mock(async (envelope: ToolCallEnvelope): Promise<ToolResult> => {
        calls.push(envelope);
        return { ...defaultResult, id: envelope.id };
      }),
      waitForAuthorization: mock(async () => true),
      getSpec: mock(() => undefined),
    },
  };
}

/**
 * Creates a mock ToolRouter that denies all calls.
 */
function createDenyingToolRouter(denyCode = 'POLICY_DENY') {
  const calls: ToolCallEnvelope[] = [];
  return {
    calls,
    router: {
      call: mock(async (envelope: ToolCallEnvelope): Promise<ToolResult> => {
        calls.push(envelope);
        return {
          id: envelope.id,
          toolName: envelope.toolName,
          source: 'builtin',
          status: 'denied' as const,
          durationMs: 1,
          error: {
            code: denyCode,
            message: `Denied by policy: ${denyCode}`,
            retryable: false,
          },
          meta: { authorization: { source: 'policy' } },
        };
      }),
      waitForAuthorization: mock(async () => true),
      getSpec: mock(() => undefined),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Unified Execution Path (Task 1.5)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalKillSwitch = process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;

  beforeEach(() => {
    clearAuditTrail();
    if (!tryGetLogger()) {
      setLogger(createLogger({ silent: true }));
    }
    // Ensure bridge kill-switch is OFF for tests that need execution
    process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = 'false';
  });

  afterEach(() => {
    clearAuditTrail();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    if (originalKillSwitch === undefined) {
      delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
    } else {
      process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = originalKillSwitch;
    }
  });

  // -------------------------------------------------------------------------
  // Property 1: Execution Path Governance
  // Validates: Requirements 1.1, 1.2, 1.5
  // -------------------------------------------------------------------------
  describe('Property 1: Execution Path Governance', () => {
    it('bridge path executor delegates to ToolRouter.call() for shell commands', async () => {
      const skill = createMockSkill({ instructions: '!sh echo hello\nDone' });
      const { router, calls } = createMockToolRouter();

      const spec = skillToToolSpec(skill, { router: router as any });
      await spec.executor({ args: 'test' }, createMockCtx());

      // ToolRouter.call() must have been invoked for the shell command
      expect(router.call).toHaveBeenCalled();
      expect(calls.length).toBeGreaterThanOrEqual(1);

      const shellCall = calls.find((c) => c.toolName === 'shell.exec');
      expect(shellCall).toBeDefined();
      expect(shellCall!.args).toEqual({ command: 'echo hello' });
    });

    it('bridge path passes correct phase and tool name to ToolRouter', async () => {
      const skill = createMockSkill({ instructions: '!sh ls -la\nResult' });
      const { router, calls } = createMockToolRouter();

      const spec = skillToToolSpec(skill, { router: router as any });
      await spec.executor({ args: '' }, createMockCtx());

      const shellCall = calls.find((c) => c.toolName === 'shell.exec');
      expect(shellCall).toBeDefined();
      expect(shellCall!.phase).toBe('SLASH');
      expect(shellCall!.toolName).toBe('shell.exec');
    });
  });

  // -------------------------------------------------------------------------
  // Property 2: No Direct Shell Bypass
  // Validates: Requirements 1.2, 1.4
  // -------------------------------------------------------------------------
  describe('Property 2: No Direct Shell Bypass', () => {
    it('legacy MicroTaskRunner throws when NODE_ENV is not "test"', () => {
      const skill = createMockSkill();

      // Temporarily set NODE_ENV to production
      process.env.NODE_ENV = 'production';

      expect(() => new MicroTaskRunner(skill)).toThrow(
        'Legacy MicroTaskRunner is restricted to test context only',
      );
    });

    it('legacy MicroTaskRunner throws when NODE_ENV is undefined', () => {
      const skill = createMockSkill();

      delete process.env.NODE_ENV;

      expect(() => new MicroTaskRunner(skill)).toThrow(
        'Legacy MicroTaskRunner is restricted to test context only',
      );
    });

    it('legacy MicroTaskRunner allows instantiation in test context', () => {
      const skill = createMockSkill();

      process.env.NODE_ENV = 'test';

      // Should not throw
      const runner = new MicroTaskRunner(skill);
      expect(runner).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Integration: Denied command blocked in both slash and bridge paths
  // Validates: Requirements 1.5, 10.1, 10.2
  // -------------------------------------------------------------------------
  describe('Denied command blocked in both paths', () => {
    it('bridge path: denied command causes skill execution to throw', async () => {
      const skill = createMockSkill({ instructions: '!sh some-command --flag\nDone' });
      const { router } = createDenyingToolRouter('POLICY_DENY');

      const spec = skillToToolSpec(skill, { router: router as any });

      await expect(spec.executor({ args: '' }, createMockCtx())).rejects.toThrow(
        'Denied by policy: POLICY_DENY',
      );
    });

    it('slash path (executeSkill): denied command causes execution to throw', async () => {
      // Import executeSkill directly to test the slash-governed path
      const { executeSkill } = await import(
        '../../../src/core/skills/runtime/SkillRunner.js'
      );

      const skill = createMockSkill({ instructions: '!sh dangerous-cmd\nDone' });
      const { router } = createDenyingToolRouter('POLICY_DENY');

      await expect(
        executeSkill({
          skill,
          argsText: '',
          toolRouter: router as any,
          toolCtx: createMockCtx(),
          route: 'slash-governed',
        }),
      ).rejects.toThrow('Denied by policy: POLICY_DENY');
    });

    it('bridge path: denied command emits SKILL_EXECUTION_DENIED audit event', async () => {
      const skill = createMockSkill({
        id: 'denied-bridge-skill',
        instructions: '!sh bad-cmd\nDone',
      });
      const { router } = createDenyingToolRouter('POLICY_DENY');

      const spec = skillToToolSpec(skill, { router: router as any });

      try {
        await spec.executor({ args: 'test-args' }, createMockCtx());
      } catch {
        // Expected to throw
      }

      const trail = getAuditTrail();
      const denyEvent = trail.find((e) => e.action === 'SKILL_EXECUTION_DENIED');
      expect(denyEvent).toBeDefined();
      expect(denyEvent!.details).toMatchObject({
        skillId: 'denied-bridge-skill',
        route: 'tool-bridge',
        denyReason: expect.any(String),
      });
    });

    it('slash path: denied command emits SKILL_EXECUTION_DENIED audit event', async () => {
      const { executeSkill } = await import(
        '../../../src/core/skills/runtime/SkillRunner.js'
      );

      const skill = createMockSkill({
        id: 'denied-slash-skill',
        instructions: '!sh bad-cmd\nDone',
      });
      const { router } = createDenyingToolRouter('POLICY_DENY');

      try {
        await executeSkill({
          skill,
          argsText: '',
          toolRouter: router as any,
          toolCtx: createMockCtx(),
          route: 'slash-governed',
        });
      } catch {
        // Expected to throw
      }

      const trail = getAuditTrail();
      const denyEvent = trail.find((e) => e.action === 'SKILL_EXECUTION_DENIED');
      expect(denyEvent).toBeDefined();
      expect(denyEvent!.details).toMatchObject({
        skillId: 'denied-slash-skill',
        route: 'slash-governed',
        denyReason: expect.any(String),
      });
    });
  });

  // -------------------------------------------------------------------------
  // Integration: Audit events emitted with correct route field
  // Validates: Requirements 1.5, 1.6, 9.1, 9.2
  // -------------------------------------------------------------------------
  describe('Audit events with correct route field', () => {
    it('bridge path emits audit events with route="tool-bridge"', async () => {
      const skill = createMockSkill({
        id: 'bridge-audit-skill',
        instructions: '!sh echo hi\nDone',
      });
      const { router } = createMockToolRouter();

      const spec = skillToToolSpec(skill, { router: router as any });
      await spec.executor({ args: '' }, createMockCtx());

      const trail = getAuditTrail();
      const startEvent = trail.find((e) => e.action === 'SKILL_EXECUTION_START');
      const endEvent = trail.find((e) => e.action === 'SKILL_EXECUTION_END');

      expect(startEvent).toBeDefined();
      expect((startEvent!.details as any).route).toBe('tool-bridge');
      expect((startEvent!.details as any).skillId).toBe('bridge-audit-skill');

      expect(endEvent).toBeDefined();
      expect((endEvent!.details as any).route).toBe('tool-bridge');
    });

    it('slash path emits audit events with route="slash-governed"', async () => {
      const { executeSkill } = await import(
        '../../../src/core/skills/runtime/SkillRunner.js'
      );

      const skill = createMockSkill({
        id: 'slash-audit-skill',
        instructions: '!sh echo hi\nDone',
      });
      const { router } = createMockToolRouter();

      await executeSkill({
        skill,
        argsText: '',
        toolRouter: router as any,
        toolCtx: createMockCtx(),
        route: 'slash-governed',
      });

      const trail = getAuditTrail();
      const startEvent = trail.find((e) => e.action === 'SKILL_EXECUTION_START');
      const endEvent = trail.find((e) => e.action === 'SKILL_EXECUTION_END');

      expect(startEvent).toBeDefined();
      expect((startEvent!.details as any).route).toBe('slash-governed');
      expect((startEvent!.details as any).skillId).toBe('slash-audit-skill');

      expect(endEvent).toBeDefined();
      expect((endEvent!.details as any).route).toBe('slash-governed');
    });

    it('executeSkill defaults to route="slash-governed" when not specified', async () => {
      const { executeSkill } = await import(
        '../../../src/core/skills/runtime/SkillRunner.js'
      );

      const skill = createMockSkill({
        id: 'default-route-skill',
        instructions: '!sh echo test\nDone',
      });
      const { router } = createMockToolRouter();

      await executeSkill({
        skill,
        argsText: '',
        toolRouter: router as any,
        toolCtx: createMockCtx(),
        // route not specified — should default to 'slash-governed'
      });

      const trail = getAuditTrail();
      const startEvent = trail.find((e) => e.action === 'SKILL_EXECUTION_START');
      expect(startEvent).toBeDefined();
      expect((startEvent!.details as any).route).toBe('slash-governed');
    });
  });
});

