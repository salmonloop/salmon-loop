import { LIMITS } from '../../config/limits.js';
import type { ExecutionPlan } from '../../grizzco/dsl/DecisionEngine.js';
import { DecisionEngine, PlanBuilder } from '../../grizzco/dsl/DecisionEngine.js';
import type { Context } from '../../types/index.js';
import type { ContextSectionChars } from '../types.js';

export interface ContextBudgetPolicyInput {
  requestedBudgetChars?: number;
  preBudgetSectionChars: ContextSectionChars;
  targetCount: number;
}

interface ContextBudgetPolicyDslContext {
  data: ContextBudgetPolicyInput;
}

/**
 * ContextBudgetPolicyDSL
 * COMPLIANCE: DSL-Spec-V3
 * - Pure and synchronous
 * - Produces an audit-friendly ExecutionPlan
 * - Does not execute packing; only declares what packing strategy to use
 */
export function ContextBudgetPolicyDSL(
  engine: DecisionEngine<ContextBudgetPolicyDslContext>,
): DecisionEngine<ContextBudgetPolicyDslContext> {
  const requestedBudgetChars =
    typeof engine.ctx.data.requestedBudgetChars === 'number'
      ? engine.ctx.data.requestedBudgetChars
      : LIMITS.maxContextChars;

  return engine.phase('Budget Policy').when(
    () => true,
    (p) => {
      p.setWorker('context-budget-policy')
        .addAction('PACK_UNTIL_FULL', {
          budgetChars: requestedBudgetChars,
          mode: 'equivalent',
        })
        .addAction('BUDGET_META', {
          preBudgetSectionChars: engine.ctx.data.preBudgetSectionChars,
          targetCount: engine.ctx.data.targetCount,
        });
    },
  );
}

export function buildContextBudgetPolicyPlan(input: ContextBudgetPolicyInput): ExecutionPlan {
  const ctx: ContextBudgetPolicyDslContext = { data: input };
  const engine = new DecisionEngine(ctx, new PlanBuilder<ContextBudgetPolicyDslContext>());
  const result = ContextBudgetPolicyDSL(engine).build();
  if (result.type !== 'PLAN') {
    throw new Error(`ContextBudgetPolicyDSL produced unexpected result: ${result.type}`);
  }
  return result.plan;
}

export function executeContextBudgetPolicyPlan(args: {
  plan: ExecutionPlan;
  context: Context;
  fallbackBudgetChars: number;
  pack: (context: Context, budgetChars: number) => { context: Context; truncated: boolean };
}): { context: Context; truncated: boolean } {
  const action = args.plan.actions.find((a) => a.type === 'PACK_UNTIL_FULL');
  const plannedBudget =
    action?.params && typeof action.params.budgetChars === 'number'
      ? action.params.budgetChars
      : args.fallbackBudgetChars;
  return args.pack(args.context, plannedBudget);
}
