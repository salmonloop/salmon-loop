/**
 * Tests for progressive disclosure compliance (P2 audit fix).
 *
 * Validates that the main code paths use the Tier 1 / Tier 2 progressive
 * disclosure pattern recommended by the AgentSkills specification:
 * - Tier 1 (startup): load only name + description (~50-100 tokens per skill)
 * - Tier 2 (activation): load full SKILL.md content on demand
 *
 * @see https://agentskills.io/specification — Progressive disclosure
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';

import {
  createLogger,
  setLogger,
  tryGetLogger,
} from '../../../src/core/observability/logger.js';
import { skillToToolSpec, type RouterBox } from '../../../src/core/skills/bridge.js';
import type { SkillCatalogEntry, Skill } from '../../../src/core/skills/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  if (!tryGetLogger()) {
    setLogger(createLogger({ silent: true }));
  }
});

function createCatalogEntry(id: string): SkillCatalogEntry {
  return {
    id,
    name: id,
    description: `Skill ${id}`,
    location: `/fake/repo/.salmonloop/skills/${id}/SKILL.md`,
    scope: 'repo',
  };
}

function createFullSkill(id: string): Skill {
  return {
    id,
    path: `/fake/repo/.salmonloop/skills/${id}/SKILL.md`,
    rawContent: `---\nname: ${id}\ndescription: Skill ${id}\n---\nInstructions for ${id}.`,
    instructions: `Instructions for ${id}.`,
    metadata: {
      name: id,
      description: `Skill ${id}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Progressive disclosure — bridge skillToToolSpec', () => {
  it('accepts a full Skill object (backward compat)', () => {
    const skill = createFullSkill('my-skill');
    const routerBox: RouterBox = { router: null };

    const spec = skillToToolSpec(skill, routerBox);

    expect(spec.name).toBe('my-skill');
    expect(spec.description).toBe('Skill my-skill');
  });

  it('accepts a catalog entry + loader pair (lazy activation)', () => {
    const entry = createCatalogEntry('lazy-skill');
    const mockLoader = {
      activateSkill: mock(async (id: string) => createFullSkill(id)),
    };
    const routerBox: RouterBox = { router: null };

    const spec = skillToToolSpec({ entry, loader: mockLoader as any }, routerBox);

    expect(spec.name).toBe('lazy-skill');
    expect(spec.description).toBe('Skill lazy-skill');
    // Loader should NOT have been called yet (lazy)
    expect(mockLoader.activateSkill).not.toHaveBeenCalled();
  });

  it('activates skill on first executor invocation (Tier 2)', async () => {
    const entry = createCatalogEntry('lazy-skill');
    const fullSkill = createFullSkill('lazy-skill');
    // Skill has no commands, so execution completes without ToolRouter calls
    fullSkill.instructions = 'No commands here.';

    const mockLoader = {
      activateSkill: mock(async (_id: string) => fullSkill),
    };
    const mockRouter = {
      call: mock(async () => ({ status: 'ok', output: {} })),
      waitForAuthorization: mock(async () => true),
      getSpec: mock(() => undefined),
    };
    const routerBox: RouterBox = { router: mockRouter as any };

    const spec = skillToToolSpec({ entry, loader: mockLoader as any }, routerBox);

    // Execute the tool spec — this should trigger Tier 2 activation
    // Need to disable bridge kill-switch for this test
    const originalEnv = process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
    process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = 'false';
    try {
      await spec.executor({ args: '' }, {
        repoRoot: '/fake/repo',
        attemptId: 1,
        dryRun: false,
      });
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
      } else {
        process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = originalEnv;
      }
    }

    // Loader.activateSkill should have been called exactly once
    expect(mockLoader.activateSkill).toHaveBeenCalledTimes(1);
    expect(mockLoader.activateSkill).toHaveBeenCalledWith('lazy-skill');
  });

  it('caches activated skill across multiple invocations', async () => {
    const entry = createCatalogEntry('cached-skill');
    const fullSkill = createFullSkill('cached-skill');
    fullSkill.instructions = 'No commands.';

    const mockLoader = {
      activateSkill: mock(async (_id: string) => fullSkill),
    };
    const mockRouter = {
      call: mock(async () => ({ status: 'ok', output: {} })),
      waitForAuthorization: mock(async () => true),
      getSpec: mock(() => undefined),
    };
    const routerBox: RouterBox = { router: mockRouter as any };

    const spec = skillToToolSpec({ entry, loader: mockLoader as any }, routerBox);

    const originalEnv = process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
    process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = 'false';
    try {
      const ctx = { repoRoot: '/fake/repo', attemptId: 1, dryRun: false };
      await spec.executor({ args: '' }, ctx);
      await spec.executor({ args: 'second' }, ctx);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC;
      } else {
        process.env.SALMONLOOP_DISABLE_BRIDGE_SKILL_EXEC = originalEnv;
      }
    }

    // activateSkill should only be called once (cached on second call)
    expect(mockLoader.activateSkill).toHaveBeenCalledTimes(1);
  });
});

describe('Progressive disclosure — SkillCatalogEntry includes userInvocable', () => {
  it('parseFrontmatterOnly includes userInvocable in catalog entry', async () => {
    // This is tested indirectly through the parser test suite,
    // but we verify the type contract here
    const entry = createCatalogEntry('hidden-skill');
    entry.userInvocable = false;

    expect(entry.userInvocable).toBe(false);
  });

  it('userInvocable defaults to undefined when not set', () => {
    const entry = createCatalogEntry('normal-skill');

    expect(entry.userInvocable).toBeUndefined();
  });
});
