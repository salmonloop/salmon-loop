/**
 * Error stack truncation strategy.
 *
 * Preserves complete error information - errors are critical for debugging.
 * Only truncates if absolutely necessary, preserving the error message and
 * top of stack trace.
 */

import type {
  TruncatedOutput,
  TruncationStrategy,
  TruncationConfig,
  OutputType,
} from '../types.js';
import { DEFAULT_TRUNCATION_CONFIG } from '../types.js';

/**
 * Error stack truncation strategy.
 * Prioritizes preserving all error information.
 */
export class ErrorStackStrategy implements TruncationStrategy {
  readonly name = 'error_stack';
  readonly supportedTypes: OutputType[] = ['error_stack'];

  constructor(private config: TruncationConfig = DEFAULT_TRUNCATION_CONFIG) {}

  canHandle(output: string): boolean {
    return /^\s*\w*Error:|^\s+at\s+.+\(/m.test(output);
  }

  truncate(output: string, budget: number): TruncatedOutput {
    const lines = output.split('\n');
    const keyInfoPreserved: string[] = [];

    // If output fits in budget, return as-is
    if (output.length <= budget) {
      return {
        content: output,
        wasTruncated: false,
        strategy: this.name,
        keyInfoPreserved: ['complete_error'],
      };
    }

    // Find error lines (Error: TypeError:, etc.)
    const errorLines: number[] = [];
    const stackLines: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\w*Error:|TypeError:|ReferenceError:|SyntaxError:|RuntimeError:/i.test(line)) {
        errorLines.push(i);
      } else if (/^\s+at\s+/.test(line)) {
        stackLines.push(i);
      }
    }

    // Preserve error messages with context
    const preservedIndices = new Set<number>();

    // Always preserve first line (often the error message)
    preservedIndices.add(0);

    // Preserve all error lines
    for (const idx of errorLines) {
      preservedIndices.add(idx);
      // Add context lines around error
      for (
        let j = Math.max(0, idx - this.config.contextLines);
        j <= Math.min(lines.length - 1, idx + this.config.contextLines);
        j++
      ) {
        preservedIndices.add(j);
      }
    }

    // Preserve top of stack trace (most relevant)
    for (let i = 0; i < Math.min(5, stackLines.length); i++) {
      preservedIndices.add(stackLines[i]);
    }

    // Build truncated output
    const result: string[] = [];
    let currentLength = 0;
    let lastAdded = -2;

    for (let i = 0; i < lines.length; i++) {
      if (preservedIndices.has(i)) {
        // Add truncation marker if there's a gap
        if (i > lastAdded + 1 && lastAdded >= 0) {
          result.push(this.config.truncationMarker);
          currentLength += this.config.truncationMarker.length;
        }
        result.push(lines[i]);
        currentLength += lines[i].length + 1; // +1 for newline
        lastAdded = i;
      }

      // Check budget
      if (currentLength > budget) {
        break;
      }
    }

    keyInfoPreserved.push('error_messages');
    if (stackLines.length > 0) keyInfoPreserved.push('stack_trace_top');

    return {
      content: result.join('\n'),
      wasTruncated: true,
      strategy: this.name,
      keyInfoPreserved,
    };
  }
}
