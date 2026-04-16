/**
 * Tests for allowed-tools runtime enforcement (P1 audit fix).
 *
 * Validates that the `allowed-tools` frontmatter field is enforced at
 * runtime, not just parsed. When a skill declares allowed-tools, only
 * those tools may be invoked during execution.
 *
 * @see https://agentskills.io/specification — allowed-tools field
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

import { clearAuditTrail, getAuditTrail } from '../../../src/core/observability/audit-trail.js';
import { createLogger, setLogger, tryGetLogger } from '../../../src/core/observability/logger.js';
import {
  executeSkill,
  matchAllowedTool,
  isToolPermitted,
} from '../../../src/core/skills/runtime/SkillRunner.js';
import type { Skill } from '../../../src/core/skills/types.js';
import type {
  ToolCallEnvelope,
  ToolResult,
  ToolRuntimeCtx,
} from '../../../src/core/tools/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearAuditTrail();
  if (!tryGetLogger()) {
    setLogger(createLogger({ silent: true }));
  }
});

function createSkillWithAllowedTools(allowedToolsSpec?: string, allowedToolsExt?: string[]): Skill {
  return {
    id: 'test-skill',
    path: '/fake/path/test-skill/SKILL.md',
    rawContent: '',
    instructions: '!sh echo hello',
    metadata: {
      name: 'test-skill',
      description: 'A test skill',
      ...(allowedToolsSpec !== undefined ? { 'allowed-tools': allowedToolsSpec } : {}),
      ...(allowedToolsExt !== undefined ? { allowedTools: allowedToolsExt } : {}),
    },
  };
}

function createMockCtx(): ToolRuntimeCtx {
  return {
    repoRoot: '/fake/repo',
    attemptId: 1,
    dryRun: false,
  };
}

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('allowed-tools runtime enforcement', () => {
  it('allows execution when shell.exec is in allowed-tools (spec field)', async () => {
    const skill = createSkillWithAllowedTools('shell.exec tool-a');
    const { router } = createMockToolRouter();

    const result = await executeSkill({
      skill,
      argsText: '',
      toolRouter: router as any,
      toolCtx: createMockCtx(),
    });

    expect(result.status).toBe('SUCCESS');
  });

  it('does not enforce extension-only allowedTools field', async () => {
    const skill = createSkillWithAllowedTools(undefined, ['shell.exec', 'tool-b']);
    const { router } = createMockToolRouter();

    const result = await executeSkill({
      skill,
      argsText: '',
      toolRouter: router as any,
      toolCtx: createMockCtx(),
    });

    expect(result.status).toBe('SUCCESS');
  });

  it('denies execution when shell.exec is NOT in allowed-tools', async () => {
    const skill = createSkillWithAllowedTools('tool-a tool-b');
    const { router } = createMockToolRouter();

    await expect(
      executeSkill({
        skill,
        argsText: '',
        toolRouter: router as any,
        toolCtx: createMockCtx(),
      }),
    ).rejects.toThrow('not permitted');
  });

  it('emits SKILL_EXECUTION_DENIED audit event on allowed-tools violation', async () => {
    const skill = createSkillWithAllowedTools('tool-a');
    const { router } = createMockToolRouter();

    try {
      await executeSkill({
        skill,
        argsText: '',
        toolRouter: router as any,
        toolCtx: createMockCtx(),
      });
    } catch {
      // Expected to throw
    }

    const trail = getAuditTrail();
    const denied = trail.filter(
      (e) =>
        e.action === 'SKILL_EXECUTION_DENIED' &&
        (e.details as any)?.denyReason === 'ALLOWED_TOOLS_VIOLATION',
    );
    expect(denied.length).toBeGreaterThanOrEqual(1);
  });

  it('does not enforce when no allowed-tools is declared', async () => {
    const skill = createSkillWithAllowedTools();
    const { router } = createMockToolRouter();

    const result = await executeSkill({
      skill,
      argsText: '',
      toolRouter: router as any,
      toolCtx: createMockCtx(),
    });

    expect(result.status).toBe('SUCCESS');
  });

  it('denies all tools when allowed-tools is explicitly empty string', async () => {
    const skill = createSkillWithAllowedTools('');
    const { router, calls } = createMockToolRouter();

    await expect(
      executeSkill({
        skill,
        argsText: '',
        toolRouter: router as any,
        toolCtx: createMockCtx(),
      }),
    ).rejects.toThrow('not permitted');

    expect(calls.length).toBe(0);
  });

  it('does not enforce when only extension allowedTools is explicitly empty array', async () => {
    const skill = createSkillWithAllowedTools(undefined, []);
    const { router, calls } = createMockToolRouter();

    const result = await executeSkill({
      skill,
      argsText: '',
      toolRouter: router as any,
      toolCtx: createMockCtx(),
    });

    expect(result.status).toBe('SUCCESS');
    expect(calls.length).toBe(1);
  });

  it('enforces only spec allowed-tools field when extension field is also present', async () => {
    // spec field has tool-a, extension has shell.exec (ignored for enforcement)
    const skill = createSkillWithAllowedTools('tool-a', ['shell.exec']);
    const { router, calls } = createMockToolRouter();

    await expect(
      executeSkill({
        skill,
        argsText: '',
        toolRouter: router as any,
        toolCtx: createMockCtx(),
      }),
    ).rejects.toThrow('not permitted');
    expect(calls.length).toBe(0);
  });

  it('does not call ToolRouter when allowed-tools violation occurs', async () => {
    const skill = createSkillWithAllowedTools('tool-a');
    const { router, calls } = createMockToolRouter();

    try {
      await executeSkill({
        skill,
        argsText: '',
        toolRouter: router as any,
        toolCtx: createMockCtx(),
      });
    } catch {
      // Expected
    }

    // ToolRouter.call should never have been invoked
    expect(calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Glob matching edge cases (Requirements 3.1, 3.2, 3.3, 3.4, 3.6)
// ---------------------------------------------------------------------------

describe('glob matching edge cases', () => {
  // --- matchAllowedTool: glob with * wildcard ---

  it('shell.* matches shell.exec', () => {
    expect(matchAllowedTool('shell.*', 'shell.exec')).toBe(true);
  });

  it('shell.* matches shell.search', () => {
    expect(matchAllowedTool('shell.*', 'shell.search')).toBe(true);
  });

  it('shell.* does NOT match code.exec', () => {
    expect(matchAllowedTool('shell.*', 'code.exec')).toBe(false);
  });

  // --- matchAllowedTool: wildcard-only pattern ---

  it('* matches any tool name', () => {
    expect(matchAllowedTool('*', 'shell.exec')).toBe(true);
    expect(matchAllowedTool('*', 'code.search')).toBe(true);
    expect(matchAllowedTool('*', 'anything')).toBe(true);
  });

  // --- matchAllowedTool: exact match (no wildcard) ---

  it('shell.exec exact match returns true', () => {
    expect(matchAllowedTool('shell.exec', 'shell.exec')).toBe(true);
  });

  it('shell.exec does NOT match shell.search', () => {
    expect(matchAllowedTool('shell.exec', 'shell.search')).toBe(false);
  });

  // --- matchAllowedTool: ? and [ treated as literals (Req 3.6) ---

  it('shell.? treated literally — does not match shell.x', () => {
    expect(matchAllowedTool('shell.?', 'shell.x')).toBe(false);
  });

  it('shell.? matches literal shell.?', () => {
    expect(matchAllowedTool('shell.?', 'shell.?')).toBe(true);
  });

  it('shell.[a] treated literally — does not match shell.a', () => {
    expect(matchAllowedTool('shell.[a]', 'shell.a')).toBe(false);
  });

  // --- matchAllowedTool: empty pattern ---

  it('empty pattern does not match anything', () => {
    expect(matchAllowedTool('', 'shell.exec')).toBe(false);
  });

  // --- isToolPermitted: null set (no restriction, Req 3.3) ---

  it('isToolPermitted with null set returns true (no restriction)', () => {
    expect(isToolPermitted('shell.exec', null)).toBe(true);
  });

  // --- isToolPermitted: empty set (deny all, Req 3.4) ---

  it('isToolPermitted with empty set returns false (deny all)', () => {
    expect(isToolPermitted('shell.exec', new Set())).toBe(false);
  });

  // --- isToolPermitted: set with matching glob (Req 3.1, 3.2) ---

  it('isToolPermitted with set containing matching glob returns true', () => {
    expect(isToolPermitted('shell.exec', new Set(['shell.*']))).toBe(true);
  });

  // --- isToolPermitted: set with no matching patterns ---

  it('isToolPermitted with set containing no matching patterns returns false', () => {
    expect(isToolPermitted('shell.exec', new Set(['code.*', 'tool-a']))).toBe(false);
  });
});
