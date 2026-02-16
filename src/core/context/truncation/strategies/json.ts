/**
 * JSON truncation strategy.
 *
 * Preserves JSON structure while truncating large arrays/objects.
 * Keeps root structure and key names visible.
 */

import type {
  TruncatedOutput,
  TruncationStrategy,
  TruncationConfig,
  OutputType,
} from '../types.js';
import { DEFAULT_TRUNCATION_CONFIG } from '../types.js';

/**
 * JSON truncation strategy.
 * Preserves structure while truncating large arrays/objects.
 */
export class JsonStrategy implements TruncationStrategy {
  readonly name = 'json';
  readonly supportedTypes: OutputType[] = ['json'];

  constructor(private config: TruncationConfig = DEFAULT_TRUNCATION_CONFIG) {}

  canHandle(output: string): boolean {
    try {
      JSON.parse(output);
      return true;
    } catch {
      return false;
    }
  }

  truncate(output: string, budget: number): TruncatedOutput {
    const keyInfoPreserved: string[] = [];

    // If output fits in budget, return as-is
    if (output.length <= budget) {
      return {
        content: output,
        wasTruncated: false,
        strategy: this.name,
        keyInfoPreserved: ['complete_json'],
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      // Not valid JSON, fall back to simple truncation
      return this.simpleTruncate(output, budget);
    }

    // Truncate while preserving structure
    const truncated = this.truncateValue(parsed, budget - 100); // Reserve space for markers
    const result = JSON.stringify(truncated.value, null, 2);

    if (truncated.truncated) {
      keyInfoPreserved.push('structure');
      keyInfoPreserved.push('root_keys');
    }

    return {
      content: result,
      wasTruncated: truncated.truncated,
      strategy: this.name,
      keyInfoPreserved,
    };
  }

  private simpleTruncate(output: string, budget: number): TruncatedOutput {
    const head = output.slice(0, Math.floor(budget / 2));
    const tail = output.slice(-Math.floor(budget / 2));

    return {
      content: `${head}${this.config.truncationMarker}${tail}`,
      wasTruncated: true,
      strategy: 'json_simple',
      keyInfoPreserved: ['head', 'tail'],
    };
  }

  private truncateValue(value: unknown, budget: number): { value: unknown; truncated: boolean } {
    if (value === null || value === undefined) {
      return { value, truncated: false };
    }

    if (typeof value !== 'object') {
      // Primitive value
      const str = String(value);
      if (str.length > budget) {
        return {
          value: str.slice(0, budget - 20) + '...[truncated]',
          truncated: true,
        };
      }
      return { value, truncated: false };
    }

    if (Array.isArray(value)) {
      return this.truncateArray(value, budget);
    }

    // Object
    return this.truncateObject(value as Record<string, unknown>, budget);
  }

  private truncateArray(arr: unknown[], budget: number): { value: unknown[]; truncated: boolean } {
    const maxItems = 10; // Max items to show at start and end
    const result: unknown[] = [];
    let truncated = false;

    if (arr.length <= maxItems * 2) {
      // Small array, truncate items if needed
      for (const item of arr) {
        const truncatedItem = this.truncateValue(item, budget / arr.length);
        result.push(truncatedItem.value);
        if (truncatedItem.truncated) truncated = true;
      }
    } else {
      // Large array, keep first and last items
      const head = arr.slice(0, maxItems);
      const tail = arr.slice(-maxItems);

      for (const item of head) {
        const truncatedItem = this.truncateValue(item, budget / (maxItems * 2));
        result.push(truncatedItem.value);
        if (truncatedItem.truncated) truncated = true;
      }

      // Add placeholder for truncated middle
      const middleCount = arr.length - maxItems * 2;
      result.push(`... ${middleCount} more items ...`);
      truncated = true;

      for (const item of tail) {
        const truncatedItem = this.truncateValue(item, budget / (maxItems * 2));
        result.push(truncatedItem.value);
        if (truncatedItem.truncated) truncated = true;
      }
    }

    return { value: result, truncated };
  }

  private truncateObject(
    obj: Record<string, unknown>,
    budget: number,
  ): { value: Record<string, unknown>; truncated: boolean } {
    const result: Record<string, unknown> = {};
    let truncated = false;
    const entries = Object.entries(obj);

    // Keep all keys but truncate values
    for (const [key, value] of entries) {
      const truncatedValue = this.truncateValue(value, budget / entries.length);
      result[key] = truncatedValue.value;
      if (truncatedValue.truncated) truncated = true;
    }

    return { value: result, truncated };
  }
}
