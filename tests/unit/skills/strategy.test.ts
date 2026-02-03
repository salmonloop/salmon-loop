import { describe, it, expect } from 'vitest';

import { DecisionEngine, PlanBuilder } from '../../../src/core/grizzco/dsl/DecisionEngine.js';
import { SkillStrategyDSL } from '../../../src/core/skills/strategy.js';

describe('SkillStrategyDSL (Unit)', () => {
  const createMockEngine = (data: any) => {
    const ctx = {
      data,
      repoRoot: '/tmp',
      runtime: { attemptId: 1, startTime: Date.now(), needsRollback: false },
    } as any;
    return new DecisionEngine(ctx, new PlanBuilder());
  };

  it('should return NEED_DATA when sh: command is missing', () => {
    const skill = {
      instructions: '!sh git status\nFinal prompt.',
    };
    const required_sh_keys = ['sh:git status'];
    const engine = createMockEngine({ skill, inputs: {}, required_sh_keys });

    // COMPLIANCE: DSL-Spec-V3 - Explicit NEED_DATA result
    const result = SkillStrategyDSL(engine).build();
    expect(result.type).toBe('NEED_DATA');
    if (result.type === 'NEED_DATA') {
      expect(result.keys).toEqual(['sh:git status']);
    }
  });

  it('should return PLAN with assembled prompt when data is satisfied', () => {
    const skill = {
      id: 'test',
      instructions: '!sh git status\nHello $USER.',
    };
    const required_sh_keys = ['sh:git status'];
    const engine = createMockEngine({
      skill,
      inputs: { USER: 'Alice' },
      required_sh_keys,
      prompt: 'Hello Alice.',
      'sh:git status': 'on branch main',
    });
    const result = SkillStrategyDSL(engine).build();

    if (result.type !== 'PLAN') {
      throw new Error('Expected PLAN');
    }
    const injectAction = result.plan.actions.find((a) => a.type === 'INJECT_PROMPT');
    expect(injectAction?.params?.prompt).toBe('Hello Alice.');
  });

  it('should abort elegantly if skill instructions are missing', () => {
    const engine = createMockEngine({ skill: { id: 'fail' }, inputs: {} });
    const result = SkillStrategyDSL(engine).build();

    if (result.type !== 'PLAN') {
      throw new Error('Expected PLAN');
    }
    expect(result.plan.shouldAbort).toBe(true);
    expect(result.plan.abortReason).toBe('Skill has no instructions');
  });
});
