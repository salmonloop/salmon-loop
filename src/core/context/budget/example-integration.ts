/**
 * Example: How to integrate dynamic budget adjustment into the execution loop.
 *
 * This is a reference implementation showing where to hook in the adjuster.
 */

import type { VerifyResult } from '../../verification/runner.js';
import type { ContextResult } from '../types.js';

import { getGlobalAdjuster } from './dynamic-adjuster.js';
import { applyBudgetAdjustment, collectBudgetMetrics } from './integration.js';

/**
 * Example loop iteration with dynamic budget adjustment.
 */
export async function exampleLoopIteration(params: {
  iteration: number;
  currentBudget: number;
  buildContext: (budget: number) => Promise<ContextResult>;
  verify: () => Promise<VerifyResult>;
}): Promise<{ newBudget: number; adjustmentReason?: string }> {
  const { iteration, currentBudget, buildContext, verify } = params;

  // 1. Build context with current budget
  const contextResult = await buildContext(currentBudget);

  // 2. Execute and verify
  const verifyResult = await verify();

  // 3. Collect metrics
  const metrics = collectBudgetMetrics({
    contextResult,
    verifyResult,
    iteration,
  });

  // 4. Record metrics for future adjustments
  getGlobalAdjuster().recordMetrics(metrics);

  // 5. Calculate adjustment for next iteration
  const adjustment = applyBudgetAdjustment(currentBudget);

  if (adjustment) {
    return {
      newBudget: adjustment.newBudget,
      adjustmentReason: adjustment.reason,
    };
  }

  return { newBudget: currentBudget };
}

/**
 * Integration points in the actual loop:
 *
 * 1. After context build (in context-budget.ts):
 *    - Collect metrics from ContextResult
 *
 * 2. After verification (in loop iteration):
 *    - Record verification result
 *    - Calculate adjustment
 *
 * 3. Before next iteration:
 *    - Apply new budget if recommended
 *    - Emit adjustment event for observability
 */
