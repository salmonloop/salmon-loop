/**
 * Test result truncation strategy.
 *
 * Preserves failed test information, error messages, and summary.
 * Truncates passing test details and verbose output.
 */

import type {
  TruncatedOutput,
  TruncationStrategy,
  TruncationConfig,
  OutputType,
} from '../types.js';
import { DEFAULT_TRUNCATION_CONFIG } from '../types.js';

/**
 * Test result truncation strategy.
 * Prioritizes failed tests and error messages.
 */
export class TestResultStrategy implements TruncationStrategy {
  readonly name = 'test_result';
  readonly supportedTypes: OutputType[] = ['test_result'];

  constructor(private config: TruncationConfig = DEFAULT_TRUNCATION_CONFIG) {}

  canHandle(output: string): boolean {
    return (
      /\d+\s+(passed|failed|skipped)/i.test(output) ||
      /FAIL\s*[(:]/i.test(output) ||
      /✓|✗|✅|❌/.test(output) ||
      /FAILURES:/i.test(output)
    );
  }

  truncate(output: string, budget: number): TruncatedOutput {
    const keyInfoPreserved: string[] = [];

    // If output fits in budget, return as-is
    if (output.length <= budget) {
      return {
        content: output,
        wasTruncated: false,
        strategy: this.name,
        keyInfoPreserved: ['complete_results'],
      };
    }

    const lines = output.split('\n');

    // Categorize lines
    const categories = {
      summary: [] as number[], // Summary lines (X passed, Y failed)
      failures: [] as number[], // Failure headers
      errors: [] as number[], // Error messages
      stackTraces: [] as number[], // Stack traces
      passing: [] as number[], // Passing test lines
      other: [] as number[], // Other lines
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (/^\s*Tests?\s*:\s*\d+/.test(line) || /^\s*Passing\s*:\s*\d+/.test(line)) {
        categories.summary.push(i);
      } else if (/^\s*Failing\s*:\s*\d+/.test(line) || /FAIL\s*[(:]/i.test(line)) {
        categories.failures.push(i);
      } else if (/^\s*✗|^\s*✘|^\s*FAIL|AssertionError/i.test(line)) {
        categories.failures.push(i);
      } else if (/^\s+at\s+.+\(/.test(line) || /^\s+at\s+\w+/.test(line)) {
        categories.stackTraces.push(i);
      } else if (/^\s*✓|^\s*✔|^\s*PASS/i.test(line)) {
        categories.passing.push(i);
      } else if (/Error:|expected|actual|received/i.test(line)) {
        categories.errors.push(i);
      } else {
        categories.other.push(i);
      }
    }

    // Select lines by priority
    const selectedIndices = new Set<number>();
    let currentLength = 0;

    // Priority order: summary > failures > errors > stack traces > other > passing
    const priorityOrder: (keyof typeof categories)[] = [
      'summary',
      'failures',
      'errors',
      'stackTraces',
      'other',
      'passing',
    ];

    for (const category of priorityOrder) {
      const indices = categories[category];
      const maxLines = category === 'passing' ? 5 : Infinity; // Limit passing lines

      let addedFromCategory = 0;
      for (const index of indices) {
        if (addedFromCategory >= maxLines) break;

        const line = lines[index];
        const lineLength = line.length + 1;

        if (currentLength + lineLength > budget) {
          break;
        }

        // Add context for failures
        if (category === 'failures' || category === 'errors') {
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

        if (!selectedIndices.has(index)) {
          selectedIndices.add(index);
          currentLength += lineLength;
        }
        addedFromCategory++;
      }
    }

    // Build result in original order
    const result: string[] = [];
    let lastAdded = -2;

    const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);

    for (const index of sortedIndices) {
      if (index > lastAdded + 1 && lastAdded >= 0) {
        result.push(this.config.truncationMarker);
      }
      result.push(lines[index]);
      lastAdded = index;
    }

    // Track what was preserved
    if (categories.summary.length > 0) keyInfoPreserved.push('summary');
    if (categories.failures.length > 0) keyInfoPreserved.push('failures');
    if (categories.errors.length > 0) keyInfoPreserved.push('errors');

    return {
      content: result.join('\n'),
      wasTruncated: true,
      strategy: this.name,
      keyInfoPreserved,
    };
  }
}
