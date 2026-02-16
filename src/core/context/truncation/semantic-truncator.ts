/**
 * Semantic truncator - main entry point.
 *
 * Analyzes output type and applies appropriate truncation strategy.
 */

import {
  ErrorStackStrategy,
  JsonStrategy,
  GitDiffStrategy,
  LogStrategy,
  TestResultStrategy,
  GenericStrategy,
} from './strategies/index.js';
import { detectOutputType, detectOutputTypeWithHint } from './type-detector.js';
import { DEFAULT_TRUNCATION_CONFIG } from './types.js';
import type { OutputType, TruncatedOutput, TruncationConfig } from './types.js';
import type { TruncationStrategy } from './types.js';

/**
 * Semantic truncator with type-aware strategies.
 */
export class SemanticTruncator {
  private strategies: TruncationStrategy[];

  constructor(private config: TruncationConfig = DEFAULT_TRUNCATION_CONFIG) {
    // Register all strategies
    this.strategies = [
      new ErrorStackStrategy(config),
      new JsonStrategy(config),
      new GitDiffStrategy(config),
      new LogStrategy(config),
      new TestResultStrategy(config),
      new GenericStrategy(config), // Must be last (fallback)
    ];
  }

  /**
   * Truncate output using appropriate strategy.
   *
   * @param output - Raw output string
   * @param budget - Maximum character budget
   * @param typeHint - Optional type hint for detection
   * @returns Truncated output with metadata
   */
  truncate(output: string, budget: number, typeHint?: string): TruncatedOutput {
    // Detect output type
    const detection = typeHint
      ? detectOutputTypeWithHint(output, typeHint)
      : detectOutputType(output);

    // Find appropriate strategy
    const strategy = this.findStrategy(detection.type);

    // Apply truncation
    return strategy.truncate(output, budget);
  }

  /**
   * Truncate output with explicit type.
   *
   * @param output - Raw output string
   * @param type - Explicit output type
   * @param budget - Maximum character budget
   * @returns Truncated output with metadata
   */
  truncateWithType(output: string, type: OutputType, budget: number): TruncatedOutput {
    const strategy = this.findStrategy(type);
    return strategy.truncate(output, budget);
  }

  /**
   * Detect output type without truncating.
   *
   * @param output - Raw output string
   * @returns Detected type with confidence
   */
  detectType(output: string): { type: OutputType; confidence: number } {
    return detectOutputType(output);
  }

  /**
   * Find strategy for given type.
   */
  private findStrategy(type: OutputType): TruncationStrategy {
    for (const strategy of this.strategies) {
      if (strategy.supportedTypes.includes(type)) {
        return strategy;
      }
    }
    // Fallback to generic
    return this.strategies[this.strategies.length - 1];
  }
}

/**
 * Global truncator instance.
 */
let globalTruncator: SemanticTruncator | null = null;

/**
 * Get global truncator instance.
 */
export function getSemanticTruncator(): SemanticTruncator {
  if (!globalTruncator) {
    globalTruncator = new SemanticTruncator();
  }
  return globalTruncator;
}

/**
 * Convenience function for semantic truncation.
 *
 * @param output - Raw output string
 * @param budget - Maximum character budget
 * @param typeHint - Optional type hint
 * @returns Truncated output
 */
export function truncateOutput(output: string, budget: number, typeHint?: string): TruncatedOutput {
  return getSemanticTruncator().truncate(output, budget, typeHint);
}
