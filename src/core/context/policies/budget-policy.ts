import { LIMITS } from '../../config/limits.js';
import type { ExecutionPlan } from '../../grizzco/dsl/DecisionEngine.js';
import type { Context } from '../../types/context.js';
import type { ContextSectionChars } from '../types.js';

export interface ContextBudgetPolicyInput {
  requestedBudgetChars?: number;
  preBudgetSectionChars: ContextSectionChars;
  targetCount: number;
}

export function buildContextBudgetPolicyPlan(input: ContextBudgetPolicyInput): ExecutionPlan {
  const requestedBudgetChars =
    typeof input.requestedBudgetChars === 'number'
      ? input.requestedBudgetChars
      : LIMITS.maxContextChars;

  return {
    shouldAbort: false,
    workerId: 'context-budget-policy',
    actions: [
      {
        type: 'PACK_UNTIL_FULL',
        params: { budgetChars: requestedBudgetChars, mode: 'equivalent' },
      },
      {
        type: 'BUDGET_META',
        params: {
          preBudgetSectionChars: input.preBudgetSectionChars,
          targetCount: input.targetCount,
        },
      },
    ],
    decisionTree: [
      `Budget Policy: requestedBudgetChars=${requestedBudgetChars}`,
      'Action: PACK_UNTIL_FULL (equivalent)',
      `Meta: targetCount=${input.targetCount}`,
    ],
  };
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
