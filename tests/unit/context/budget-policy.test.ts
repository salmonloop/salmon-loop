import {
  buildContextBudgetPolicyPlan,
  executeContextBudgetPolicyPlan,
} from '../../../src/core/context/policies/budget-policy.js';
import { packUntilFull } from '../../../src/core/context/policies/pack-until-full.js';
import type { Context } from '../../../src/core/types/index.js';

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    repoPath: '/repo',
    primaryFile: 'src/a.ts',
    primaryText: '0123456789',
    rgSnippets: [],
    ...overrides,
  };
}

describe('ContextBudgetPolicyDSL', () => {
  it('builds a packing plan with explicit budget', () => {
    const plan = buildContextBudgetPolicyPlan({
      requestedBudgetChars: 123,
      preBudgetSectionChars: { primary: 1, relatedFiles: 2, rgSnippets: 3, diffs: 4, total: 10 },
      targetCount: 2,
    });

    expect(plan.workerId).toBe('context-budget-policy');
    expect(plan.actions.some((a) => a.type === 'PACK_UNTIL_FULL')).toBe(true);
    const packAction = plan.actions.find((a) => a.type === 'PACK_UNTIL_FULL');
    expect(packAction?.params?.budgetChars).toBe(123);
  });

  it('executes equivalently to direct packUntilFull', () => {
    const ctx = makeContext({
      primaryText: 'x'.repeat(50),
      rgSnippets: [
        { file: 'src/a.ts', line: 1, content: 'a'.repeat(50) },
        { file: 'src/b.ts', line: 2, content: 'b'.repeat(50) },
      ],
      stagedDiff: 'diff'.repeat(50),
    });

    const budgetChars = 120;
    const preBudgetSectionChars = {
      primary: ctx.primaryText?.length ?? 0,
      relatedFiles: 0,
      rgSnippets: ctx.rgSnippets.reduce((sum, s) => sum + s.content.length, 0),
      diffs: ctx.stagedDiff?.length ?? 0,
      total:
        (ctx.primaryText?.length ?? 0) +
        ctx.rgSnippets.reduce((sum, s) => sum + s.content.length, 0) +
        (ctx.stagedDiff?.length ?? 0),
    };

    const plan = buildContextBudgetPolicyPlan({
      requestedBudgetChars: budgetChars,
      preBudgetSectionChars,
      targetCount: 0,
    });

    const direct = packUntilFull(ctx, budgetChars);
    const planned = executeContextBudgetPolicyPlan({
      plan,
      context: ctx,
      fallbackBudgetChars: budgetChars,
      pack: packUntilFull,
    });

    expect(planned).toEqual(direct);
  });
});
