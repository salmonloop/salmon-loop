/**
 * Generic truncation strategy.
 *
 * Fallback strategy that uses simple head/tail truncation
 * with a marker in the middle.
 */

import { DEFAULT_TRUNCATION_CONFIG } from '../types.js';
import type {
  TruncatedOutput,
  TruncationStrategy,
  TruncationConfig,
  OutputType,
} from '../types.js';

/**
 * Generic truncation strategy.
 * Uses simple head/tail truncation.
 */
export class GenericStrategy implements TruncationStrategy {
  readonly name = 'generic';
  readonly supportedTypes: OutputType[] = ['generic'];

  constructor(private config: TruncationConfig = DEFAULT_TRUNCATION_CONFIG) {}

  canHandle(_output: string): boolean {
    return true; // Always can handle
  }

  truncate(output: string, budget: number): TruncatedOutput {
    // If output fits in budget, return as-is
    if (output.length <= budget) {
      return {
        content: output,
        wasTruncated: false,
        strategy: this.name,
        keyInfoPreserved: ['complete_content'],
      };
    }

    // Reserve space for truncation marker
    const markerLength = this.config.truncationMarker.length;
    const availableBudget = budget - markerLength;

    // Split budget between head and tail (50/50)
    const headBudget = Math.floor(availableBudget / 2);
    const tailBudget = availableBudget - headBudget;

    const head = output.slice(0, headBudget);
    const tail = output.slice(-tailBudget);

    return {
      content: `${head}${this.config.truncationMarker}${tail}`,
      wasTruncated: true,
      strategy: this.name,
      keyInfoPreserved: ['head', 'tail'],
    };
  }
}
