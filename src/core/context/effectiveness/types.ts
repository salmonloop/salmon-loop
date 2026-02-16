/**
 * Context effectiveness types and interfaces.
 *
 * Tracks context usage, quality metrics, and failure attribution.
 */

/**
 * Context usage record.
 */
export interface ContextUsageRecord {
  /** File path */
  filePath: string;
  /** Whether this file was referenced by LLM */
  referenced: boolean;
  /** Token count */
  tokens: number;
  /** Relevance score (0-100) */
  relevanceScore: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Context failure record.
 */
export interface ContextFailureRecord {
  /** Failure type */
  type: 'missing_context' | 'irrelevant_context' | 'context_overload' | 'token_limit_exceeded';
  /** Description */
  description: string;
  /** Affected files (if any) */
  affectedFiles?: string[];
  /** Suggested files that should have been included */
  suggestedFiles?: string[];
  /** Timestamp */
  timestamp: number;
}

/**
 * Context quality metrics.
 */
export interface ContextMetrics {
  /** Average usage rate (files referenced / files included) */
  avgUsageRate: number;
  /** Files with low usage rate (< 20%) */
  lowUsageFiles: string[];
  /** Files frequently referenced (top performers) */
  topReferencedFiles: string[];
  /** Common missing context patterns */
  commonMissingContext: string[];
  /** Token efficiency (successful executions / total tokens) */
  tokenEfficiency: number;
  /** Total sessions tracked */
  totalSessions: number;
  /** Total files tracked */
  totalFiles: number;
  /** Average tokens per session */
  avgTokensPerSession: number;
  /** Failure breakdown by type */
  failureBreakdown: Record<string, number>;
}

/**
 * Effectiveness tracking config.
 */
export interface EffectivenessConfig {
  /** Enable tracking */
  enabled: boolean;
  /** Maximum records to keep in memory */
  maxRecords: number;
  /** Minimum relevance score to consider file "useful" */
  usefulnessThreshold: number;
  /** Sample rate for tracking (1.0 = 100%) */
  sampleRate: number;
}

/**
 * Default effectiveness config.
 */
export const DEFAULT_EFFECTIVENESS_CONFIG: EffectivenessConfig = {
  enabled: true,
  maxRecords: 1000,
  usefulnessThreshold: 20,
  sampleRate: 1.0,
};

/**
 * File effectiveness summary.
 */
export interface FileEffectivenessSummary {
  /** File path */
  path: string;
  /** Times included in context */
  timesIncluded: number;
  /** Times referenced by LLM */
  timesReferenced: number;
  /** Usage rate */
  usageRate: number;
  /** Average relevance score */
  avgRelevanceScore: number;
  /** Average tokens */
  avgTokens: number;
}
