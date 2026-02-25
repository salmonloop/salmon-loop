/**
 * Budget adjustment integration for execution loop.
 *
 * Hooks into the loop to collect metrics and apply adjustments.
 */

import type { VerifyResult } from '../../verification/runner.js';
import type { ContextResult } from '../types.js';

import { getGlobalAdjuster, type BudgetMetrics } from './dynamic-adjuster.js';
import type { BudgetRunSummary } from './dynamic-adjuster.js';

export interface BudgetStats {
  avgUtilization: number;
  truncationRate: number;
  successRate: number;
  criticalDropRate: number;
  sampleSize: number;
}

export interface BudgetAlert {
  level: 'warn';
  reason: string;
}

export interface BudgetAlertThresholds {
  truncationRateWarn: number;
  criticalDropRateWarn: number;
}

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

  adjuster.recordAdjustment();
  return {
    newBudget: adjustment.newBudget,
    reason: adjustment.reason,
  };
}

/**
 * Get current budget statistics for observability.
 */
export function getBudgetStats() {
  return getGlobalAdjuster().getStats() as BudgetStats | null;
}

/**
 * Evaluate whether budget behavior requires an operator-visible alert.
 */
export function evaluateBudgetAlert(
  stats: BudgetStats | null | undefined,
  thresholds?: Partial<BudgetAlertThresholds>,
): BudgetAlert | null {
  if (!stats || stats.sampleSize < 2) {
    return null;
  }

  const effectiveThresholds: BudgetAlertThresholds = {
    truncationRateWarn: thresholds?.truncationRateWarn ?? 0.6,
    criticalDropRateWarn: thresholds?.criticalDropRateWarn ?? 0,
  };

  if (stats.criticalDropRate > effectiveThresholds.criticalDropRateWarn) {
    return {
      level: 'warn',
      reason: `critical content dropped (${(stats.criticalDropRate * 100).toFixed(0)}%)`,
    };
  }

  if (stats.truncationRate > effectiveThresholds.truncationRateWarn) {
    return {
      level: 'warn',
      reason: `high truncation rate (${(stats.truncationRate * 100).toFixed(0)}%)`,
    };
  }

  return null;
}

export function recordBudgetAlert(): void {
  getGlobalAdjuster().recordAlert();
}

export function recordBudgetAdjustment(): void {
  getGlobalAdjuster().recordAdjustment();
}

export function getBudgetRunSummary(): BudgetRunSummary | null {
  return getGlobalAdjuster().getRunSummary();
}

export { getGlobalAdjuster };
