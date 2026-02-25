/**
 * Dynamic Budget Adjuster
 *
 * Collects runtime metrics and adjusts budget based on actual usage patterns.
 */

export interface BudgetMetrics {
  /** Total budget allocated (tokens) */
  budgetAllocated: number;
  /** Actual tokens used */
  tokensUsed: number;
  /** Whether content was truncated */
  wasTruncated: boolean;
  /** Whether critical content (targets/diffs) was dropped */
  criticalContentDropped: boolean;
  /** Verification result */
  verifySuccess: boolean;
  /** Iteration number */
  iteration: number;
}

export interface BudgetAdjustment {
  /** New recommended budget */
  newBudget: number;
  /** Adjustment reason */
  reason: string;
  /** Confidence level (0-1) */
  confidence: number;
}

export interface DynamicBudgetConfig {
  minBudget: number;
  maxBudget: number;
  adjustmentStep: number;
  alerts?: {
    truncationRateWarn?: number;
    criticalDropRateWarn?: number;
  };
}

/**
 * Budget adjustment strategy based on runtime feedback.
 */
export class DynamicBudgetAdjuster {
  private history: BudgetMetrics[] = [];
  private readonly maxHistory = 10;

  // Adjustment parameters
  private minBudget: number;
  private maxBudget: number;
  private adjustmentStep: number;
  private alertTruncationRateWarn: number;
  private alertCriticalDropRateWarn: number;

  constructor(config?: DynamicBudgetConfig) {
    this.minBudget = config?.minBudget ?? 5000;
    this.maxBudget = config?.maxBudget ?? 100000;
    this.adjustmentStep = config?.adjustmentStep ?? 0.15;
    this.alertTruncationRateWarn = config?.alerts?.truncationRateWarn ?? 0.6;
    this.alertCriticalDropRateWarn = config?.alerts?.criticalDropRateWarn ?? 0;
  }

  /**
   * Record metrics from a completed iteration.
   */
  recordMetrics(metrics: BudgetMetrics): void {
    this.history.push(metrics);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /**
   * Calculate recommended budget adjustment.
   */
  calculateAdjustment(currentBudget: number): BudgetAdjustment | null {
    if (this.history.length < 2) {
      return null; // Need at least 2 data points
    }

    const recent = this.history.slice(-3); // Last 3 iterations
    const latest = recent[recent.length - 1]!;

    // Strategy 1: Critical content dropped + failure → Increase urgently
    if (latest.criticalContentDropped && !latest.verifySuccess) {
      const newBudget = Math.min(currentBudget * (1 + this.adjustmentStep * 2), this.maxBudget);
      return {
        newBudget: Math.round(newBudget),
        reason: 'Critical content dropped and verification failed',
        confidence: 0.9,
      };
    }

    // Strategy 2: High truncation + low success rate → Increase
    const truncationRate = recent.filter((m) => m.wasTruncated).length / recent.length;
    const successRate = recent.filter((m) => m.verifySuccess).length / recent.length;

    if (truncationRate > 0.6 && successRate < 0.5) {
      const newBudget = Math.min(currentBudget * (1 + this.adjustmentStep), this.maxBudget);
      return {
        newBudget: Math.round(newBudget),
        reason: `High truncation (${(truncationRate * 100).toFixed(0)}%) and low success (${(successRate * 100).toFixed(0)}%)`,
        confidence: 0.7,
      };
    }

    // Strategy 3: Low utilization + high success → Decrease
    const avgUtilization =
      recent.reduce((sum, m) => sum + m.tokensUsed / m.budgetAllocated, 0) / recent.length;

    if (avgUtilization < 0.6 && successRate > 0.8 && !latest.wasTruncated) {
      const newBudget = Math.max(currentBudget * (1 - this.adjustmentStep * 0.5), this.minBudget);
      return {
        newBudget: Math.round(newBudget),
        reason: `Low utilization (${(avgUtilization * 100).toFixed(0)}%) with high success`,
        confidence: 0.6,
      };
    }

    // Strategy 4: Stable and successful → No change
    if (successRate > 0.7 && truncationRate < 0.3) {
      return null; // Current budget is working well
    }

    return null;
  }

  /**
   * Get current statistics.
   */
  getStats() {
    if (this.history.length === 0) {
      return null;
    }

    const recent = this.history.slice(-5);
    return {
      avgUtilization:
        recent.reduce((sum, m) => sum + m.tokensUsed / m.budgetAllocated, 0) / recent.length,
      truncationRate: recent.filter((m) => m.wasTruncated).length / recent.length,
      successRate: recent.filter((m) => m.verifySuccess).length / recent.length,
      criticalDropRate: recent.filter((m) => m.criticalContentDropped).length / recent.length,
      sampleSize: recent.length,
    };
  }

  /**
   * Reset history (e.g., when starting a new session).
   */
  reset(): void {
    this.history = [];
  }

  getAlertThresholds(): { truncationRateWarn: number; criticalDropRateWarn: number } {
    return {
      truncationRateWarn: this.alertTruncationRateWarn,
      criticalDropRateWarn: this.alertCriticalDropRateWarn,
    };
  }
}

/**
 * Global adjuster instance (per session).
 */
let globalAdjuster: DynamicBudgetAdjuster | null = null;

export function getGlobalAdjuster(config?: DynamicBudgetConfig): DynamicBudgetAdjuster {
  if (!globalAdjuster) {
    globalAdjuster = new DynamicBudgetAdjuster(config);
  }
  return globalAdjuster;
}

export function resetGlobalAdjuster(): void {
  globalAdjuster = null;
}
