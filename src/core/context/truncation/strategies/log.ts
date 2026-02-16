/**
 * Log output truncation strategy.
 *
 * Preserves error/warning lines with surrounding context.
 * Removes verbose INFO/DEBUG lines when necessary.
 */

import type {
  TruncatedOutput,
  TruncationStrategy,
  TruncationConfig,
  OutputType,
} from '../types.js';
import { DEFAULT_TRUNCATION_CONFIG } from '../types.js';

/**
 * Log level priority for filtering.
 */
const LOG_LEVEL_PRIORITY: Record<string, number> = {
  FATAL: 100,
  ERROR: 90,
  ERR: 90,
  CRITICAL: 80,
  CRIT: 80,
  WARN: 70,
  WARNING: 70,
  INFO: 50,
  DEBUG: 30,
  TRACE: 20,
  VERBOSE: 10,
};

/**
 * Log output truncation strategy.
 * Prioritizes error and warning lines.
 */
export class LogStrategy implements TruncationStrategy {
  readonly name = 'log';
  readonly supportedTypes: OutputType[] = ['log'];

  constructor(private config: TruncationConfig = DEFAULT_TRUNCATION_CONFIG) {}

  canHandle(output: string): boolean {
    return /^\s*(ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\s*[:[\]|]/m.test(output);
  }

  truncate(output: string, budget: number): TruncatedOutput {
    const keyInfoPreserved: string[] = [];

    // If output fits in budget, return as-is
    if (output.length <= budget) {
      return {
        content: output,
        wasTruncated: false,
        strategy: this.name,
        keyInfoPreserved: ['complete_log'],
      };
    }

    const lines = output.split('\n');

    // Score each line by importance
    const scoredLines = lines.map((line, index) => ({
      index,
      line,
      score: this.scoreLine(line),
    }));

    // Sort by score (highest first)
    const sortedByScore = [...scoredLines].sort((a, b) => b.score - a.score);

    // Select lines until budget is exhausted
    const selectedIndices = new Set<number>();
    let currentLength = 0;

    for (const { index, line } of sortedByScore) {
      const lineLength = line.length + 1;

      if (currentLength + lineLength > budget) {
        break;
      }

      selectedIndices.add(index);
      currentLength += lineLength;

      // Add context lines around important lines
      for (
        let j = Math.max(0, index - this.config.contextLines);
        j <= Math.min(lines.length - 1, index + this.config.contextLines);
        j++
      ) {
        if (!selectedIndices.has(j)) {
          const contextLine = lines[j];
          const contextLength = contextLine.length + 1;
          if (currentLength + contextLength <= budget) {
            selectedIndices.add(j);
            currentLength += contextLength;
          }
        }
      }
    }

    // Build result in original order
    const result: string[] = [];
    let lastAdded = -2;

    const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);

    for (const index of sortedIndices) {
      // Add truncation marker for gaps
      if (index > lastAdded + 1 && lastAdded >= 0) {
        result.push(this.config.truncationMarker);
      }
      result.push(lines[index]);
      lastAdded = index;
    }

    // Track what was preserved
    const errorCount = lines.filter((l) => this.scoreLine(l) >= 90).length;
    const warnCount = lines.filter((l) => this.scoreLine(l) >= 70 && this.scoreLine(l) < 90).length;

    if (errorCount > 0) keyInfoPreserved.push('error_lines');
    if (warnCount > 0) keyInfoPreserved.push('warning_lines');
    keyInfoPreserved.push('context');

    return {
      content: result.join('\n'),
      wasTruncated: true,
      strategy: this.name,
      keyInfoPreserved,
    };
  }

  /**
   * Score a log line by importance.
   * Higher score = more important to preserve.
   */
  private scoreLine(line: string): number {
    const upperLine = line.toUpperCase();

    // Check for log level indicators
    for (const [level, priority] of Object.entries(LOG_LEVEL_PRIORITY)) {
      if (upperLine.includes(level)) {
        return priority;
      }
    }

    // Check for error-like patterns
    if (/exception|failed|failure|error|crash/i.test(line)) {
      return 85;
    }

    // Timestamps are moderately important
    if (/^\s*\d{4}-\d{2}-\d{2}/.test(line)) {
      return 40;
    }

    // Default low priority
    return 10;
  }
}
