/**
 * Semantic truncation types and interfaces.
 *
 * Provides type-aware truncation for tool outputs to preserve
 * critical information while staying within token budgets.
 */

/**
 * Output types that can be semantically truncated.
 */
export type OutputType = 'error_stack' | 'json' | 'git_diff' | 'log' | 'test_result' | 'generic';

/**
 * Result of semantic truncation.
 */
export interface TruncatedOutput {
  /** Truncated content */
  content: string;
  /** Whether truncation was applied */
  wasTruncated: boolean;
  /** Strategy used for truncation */
  strategy: string;
  /** Key information preserved (descriptive) */
  keyInfoPreserved: string[];
}

/**
 * Truncation strategy interface.
 * Each output type has its own strategy implementation.
 */
export interface TruncationStrategy {
  /** Strategy name */
  readonly name: string;
  /** Output types this strategy handles */
  readonly supportedTypes: OutputType[];

  /**
   * Check if this strategy can handle the given output.
   */
  canHandle(output: string): boolean;

  /**
   * Truncate output to fit within budget.
   * @param output - Raw output string
   * @param budget - Maximum character budget
   * @returns Truncated output with metadata
   */
  truncate(output: string, budget: number): TruncatedOutput;
}

/**
 * Truncation configuration.
 */
export interface TruncationConfig {
  /** Default budget for truncation (characters) */
  defaultBudget: number;
  /** Minimum budget to preserve meaningful content */
  minBudget: number;
  /** Marker for truncated sections */
  truncationMarker: string;
  /** Context lines to preserve around important content */
  contextLines: number;
}

/**
 * Default truncation configuration.
 */
export const DEFAULT_TRUNCATION_CONFIG: TruncationConfig = {
  defaultBudget: 4000,
  minBudget: 500,
  truncationMarker: '\n... [truncated] ...\n',
  contextLines: 3,
};

/**
 * Detection result with confidence score.
 */
export interface TypeDetectionResult {
  /** Detected type */
  type: OutputType;
  /** Confidence score (0-1) */
  confidence: number;
}
