/**
 * Context effectiveness tracker.
 *
 * Tracks which context files are actually used by the LLM,
 * identifies missing context patterns, and calculates efficiency metrics.
 */

import type {
  ContextUsageRecord,
  ContextFailureRecord,
  ContextMetrics,
  EffectivenessConfig,
  FileEffectivenessSummary,
} from './types.js';
import { DEFAULT_EFFECTIVENESS_CONFIG } from './types.js';

/**
 * Context effectiveness tracker.
 *
 * Provides insights into context quality:
 * - Which files are actually useful
 * - What context is frequently missing
 * - Token efficiency trends
 */
export class ContextEffectivenessTracker {
  private usageRecords: ContextUsageRecord[] = [];
  private failureRecords: ContextFailureRecord[] = [];
  private totalTokensUsed = 0;
  private successfulExecutions = 0;
  private totalExecutions = 0;
  private sessionCount = 0;

  constructor(private config: EffectivenessConfig = DEFAULT_EFFECTIVENESS_CONFIG) {}

  /**
   * Record context usage for a file.
   */
  recordUsage(filePath: string, referenced: boolean, tokens: number, relevanceScore: number): void {
    if (!this.config.enabled) return;
    if (Math.random() > this.config.sampleRate) return;

    // Enforce max records limit
    if (this.usageRecords.length >= this.config.maxRecords) {
      this.usageRecords.shift();
    }

    this.usageRecords.push({
      filePath,
      referenced,
      tokens,
      relevanceScore,
      timestamp: Date.now(),
    });

    if (referenced) {
      this.totalTokensUsed += tokens;
    }
  }

  /**
   * Record context failure.
   */
  recordFailure(
    type: ContextFailureRecord['type'],
    description: string,
    affectedFiles?: string[],
    suggestedFiles?: string[],
  ): void {
    if (!this.config.enabled) return;

    if (this.failureRecords.length >= this.config.maxRecords) {
      this.failureRecords.shift();
    }

    this.failureRecords.push({
      type,
      description,
      affectedFiles,
      suggestedFiles,
      timestamp: Date.now(),
    });
  }

  /**
   * Record execution result.
   */
  recordExecution(success: boolean, tokensUsed: number): void {
    this.totalExecutions++;
    if (success) {
      this.successfulExecutions++;
    }
    this.totalTokensUsed += tokensUsed;
  }

  /**
   * Start a new session.
   */
  startSession(): void {
    this.sessionCount++;
  }

  /**
   * Get context metrics.
   */
  getMetrics(): ContextMetrics {
    const fileStats = this.aggregateFileStats();

    // Calculate usage rate
    const totalFiles = this.usageRecords.length;
    const referencedFiles = this.usageRecords.filter((r) => r.referenced).length;
    const avgUsageRate = totalFiles > 0 ? referencedFiles / totalFiles : 0;

    // Find low usage files
    const lowUsageFiles = Object.entries(fileStats)
      .filter(([, stats]) => stats.usageRate < 0.2)
      .map(([path]) => path);

    // Find top referenced files
    const topReferencedFiles = Object.entries(fileStats)
      .filter(([, stats]) => stats.timesReferenced >= 3)
      .sort((a, b) => b[1].timesReferenced - a[1].timesReferenced)
      .slice(0, 10)
      .map(([path]) => path);

    // Find common missing context patterns
    const missingContextPatterns = this.extractMissingContextPatterns();

    // Calculate token efficiency
    const tokenEfficiency =
      this.totalTokensUsed > 0 ? this.successfulExecutions / (this.totalTokensUsed / 1000) : 0;

    // Failure breakdown
    const failureBreakdown: Record<string, number> = {};
    for (const failure of this.failureRecords) {
      failureBreakdown[failure.type] = (failureBreakdown[failure.type] || 0) + 1;
    }

    return {
      avgUsageRate,
      lowUsageFiles,
      topReferencedFiles,
      commonMissingContext: missingContextPatterns,
      tokenEfficiency,
      totalSessions: this.sessionCount,
      totalFiles,
      avgTokensPerSession: this.sessionCount > 0 ? this.totalTokensUsed / this.sessionCount : 0,
      failureBreakdown,
    };
  }

  /**
   * Get file effectiveness summary.
   */
  getFileEffectiveness(filePath: string): FileEffectivenessSummary | null {
    const records = this.usageRecords.filter((r) => r.filePath === filePath);
    if (records.length === 0) return null;

    const timesIncluded = records.length;
    const timesReferenced = records.filter((r) => r.referenced).length;
    const totalTokens = records.reduce((sum, r) => sum + r.tokens, 0);
    const totalRelevance = records.reduce((sum, r) => sum + r.relevanceScore, 0);

    return {
      path: filePath,
      timesIncluded,
      timesReferenced,
      usageRate: timesIncluded > 0 ? timesReferenced / timesIncluded : 0,
      avgRelevanceScore: timesIncluded > 0 ? totalRelevance / timesIncluded : 0,
      avgTokens: timesIncluded > 0 ? totalTokens / timesIncluded : 0,
    };
  }

  /**
   * Get recommendations for context improvement.
   */
  getRecommendations(): string[] {
    const recommendations: string[] = [];
    const metrics = this.getMetrics();

    // Low usage rate recommendation
    if (metrics.avgUsageRate < 0.3) {
      recommendations.push(
        `Low context usage rate (${(metrics.avgUsageRate * 100).toFixed(1)}%). Consider more targeted context gathering.`,
      );
    }

    // Common missing context
    if (metrics.commonMissingContext.length > 0) {
      recommendations.push(
        `Frequently missing context: ${metrics.commonMissingContext.slice(0, 3).join(', ')}`,
      );
    }

    // Token efficiency
    if (metrics.tokenEfficiency < 0.5) {
      recommendations.push(
        'Low token efficiency. Consider refining relevance scoring or context budget.',
      );
    }

    // Failure patterns
    const missingContextFailures = metrics.failureBreakdown['missing_context'] || 0;
    if (missingContextFailures > 3) {
      recommendations.push(
        'High rate of missing context failures. Review import resolution and dependency tracking.',
      );
    }

    return recommendations;
  }

  /**
   * Reset tracking data.
   */
  reset(): void {
    this.usageRecords = [];
    this.failureRecords = [];
    this.totalTokensUsed = 0;
    this.successfulExecutions = 0;
    this.totalExecutions = 0;
    this.sessionCount = 0;
  }

  /**
   * Aggregate file statistics.
   */
  private aggregateFileStats(): Map<string, FileEffectivenessSummary> {
    const stats = new Map<string, FileEffectivenessSummary>();

    for (const record of this.usageRecords) {
      const existing = stats.get(record.filePath);
      if (existing) {
        existing.timesIncluded++;
        if (record.referenced) existing.timesReferenced++;
        existing.avgRelevanceScore = (existing.avgRelevanceScore + record.relevanceScore) / 2;
        existing.avgTokens = (existing.avgTokens + record.tokens) / 2;
      } else {
        stats.set(record.filePath, {
          path: record.filePath,
          timesIncluded: 1,
          timesReferenced: record.referenced ? 1 : 0,
          usageRate: record.referenced ? 1 : 0,
          avgRelevanceScore: record.relevanceScore,
          avgTokens: record.tokens,
        });
      }
    }

    // Recalculate usage rates
    for (const summary of stats.values()) {
      summary.usageRate =
        summary.timesIncluded > 0 ? summary.timesReferenced / summary.timesIncluded : 0;
    }

    return stats;
  }

  /**
   * Extract missing context patterns from failure records.
   */
  private extractMissingContextPatterns(): string[] {
    const patterns: string[] = [];
    const missingContextFailures = this.failureRecords.filter((f) => f.type === 'missing_context');

    // Extract suggested files
    for (const failure of missingContextFailures) {
      if (failure.suggestedFiles) {
        patterns.push(...failure.suggestedFiles);
      }
    }

    // Return unique patterns, most common first
    const patternCounts = new Map<string, number>();
    for (const pattern of patterns) {
      patternCounts.set(pattern, (patternCounts.get(pattern) || 0) + 1);
    }

    return Array.from(patternCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([pattern]) => pattern);
  }
}

/**
 * Global effectiveness tracker instance.
 */
let globalInstance: ContextEffectivenessTracker | null = null;

/**
 * Get global effectiveness tracker.
 */
export function getEffectivenessTracker(): ContextEffectivenessTracker {
  if (!globalInstance) {
    globalInstance = new ContextEffectivenessTracker();
  }
  return globalInstance;
}

/**
 * Reset global instance (for testing).
 */
export function resetEffectivenessTracker(): void {
  globalInstance = null;
}
