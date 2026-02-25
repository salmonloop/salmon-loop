/**
 * Budget adjustment integration for execution loop.
 *
 * Hooks into the loop to collect metrics and apply adjustments.
 */

import type { VerifyResult } from '../../verification/runner.js';
import type { ContextResult } from '../types.js';

import { getGlobalAdjuster, type BudgetMetrics } from './dynamic-adjuster.js';

/**
 * Collect budget metrics after context build and verification.
 */
export function collectBudgetMetrics(params: {
  contextResult: ContextResult;
  verifyResult?: VerifyResult;
  iteration: number;
}): BudgetMetrics {
  const { contextResult, verifyResult, iteration } = params;
  const meta = contextResult.meta;

  const budgetAllocated = meta.requestedBudgetChars ?? 30000;
  // Note: usedChars is treated as equivalent to tokens for budget metrics
  const tokensUsed = meta.usedChars ?? 0;
  const wasTruncated = meta.truncated ?? false;

  // Check if critical content was dropped
  const criticalContentDropped = Boolean(
    meta.droppedSections &&
    (meta.droppedSections.stagedDiff ||
      meta.droppedSections.unstagedDiff ||
      meta.droppedSections.gitDiff),
  );

  const verifySuccess = verifyResult?.ok ?? false;

  return {
    budgetAllocated,
    tokensUsed,
    wasTruncated,
    criticalContentDropped,
    verifySuccess,
    iteration,
  };
}

/**
 * Apply budget adjustment if recommended.
 * Returns new budget or null if no adjustment needed.
 */
export function applyBudgetAdjustment(currentBudget: number): {
  newBudget: number;
  reason: string;
} | null {
  const adjuster = getGlobalAdjuster();
  const adjustment = adjuster.calculateAdjustment(currentBudget);

  if (!adjustment) {
    return null;
  }

  // Only apply if confidence is high enough
  if (adjustment.confidence < 0.5) {
    return null;
  }

  return {
    newBudget: adjustment.newBudget,
    reason: adjustment.reason,
  };
}

/**
 * Get current budget statistics for observability.
 */
export function getBudgetStats() {
  return getGlobalAdjuster().getStats();
}

export { getGlobalAdjuster };
