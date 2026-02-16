/**
 * Git diff truncation strategy.
 *
 * Preserves hunk headers and file names while truncating
 * large diff sections.
 */

import type {
  TruncatedOutput,
  TruncationStrategy,
  TruncationConfig,
  OutputType,
} from '../types.js';
import { DEFAULT_TRUNCATION_CONFIG } from '../types.js';

/**
 * Git diff truncation strategy.
 * Preserves hunk headers and file metadata.
 */
export class GitDiffStrategy implements TruncationStrategy {
  readonly name = 'git_diff';
  readonly supportedTypes: OutputType[] = ['git_diff'];

  constructor(private config: TruncationConfig = DEFAULT_TRUNCATION_CONFIG) {}

  canHandle(output: string): boolean {
    return /^diff --git\s+a\/.+\s+b\/.+|^@@\s+-\d+/m.test(output);
  }

  truncate(output: string, budget: number): TruncatedOutput {
    const keyInfoPreserved: string[] = [];

    // If output fits in budget, return as-is
    if (output.length <= budget) {
      return {
        content: output,
        wasTruncated: false,
        strategy: this.name,
        keyInfoPreserved: ['complete_diff'],
      };
    }

    const lines = output.split('\n');
    const result: string[] = [];
    let currentLength = 0;

    // Preserve these line types with high priority
    const preservePatterns = [
      /^diff --git/, // File header
      /^index\s+/, // Index line
      /^---\s+/, // Source file
      /^\+\+\+\s+/, // Target file
      /^@@\s+/, // Hunk header
      /^new file mode/, // New file marker
      /^deleted file mode/, // Deleted file marker
      /^Binary files/, // Binary file marker
    ];

    // Track current hunk context
    let inHunk = false;
    let hunkStartLine = -1;
    const hunkContextLines = 10; // Lines to keep per hunk

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLength = line.length + 1; // +1 for newline

      // Check if this line should be preserved
      const shouldPreserve = preservePatterns.some((p) => p.test(line));

      if (shouldPreserve) {
        result.push(line);
        currentLength += lineLength;

        if (/^@@\s+/.test(line)) {
          inHunk = true;
          hunkStartLine = i;
          keyInfoPreserved.push('hunk_header');
        }
      } else if (inHunk) {
        // In a hunk - keep context lines
        const linesFromHunkStart = i - hunkStartLine;

        // Keep first N lines of each hunk
        if (linesFromHunkStart < hunkContextLines) {
          result.push(line);
          currentLength += lineLength;
        } else if (linesFromHunkStart === hunkContextLines) {
          // Add truncation marker
          result.push(this.config.truncationMarker);
          currentLength += this.config.truncationMarker.length;
          inHunk = false; // Stop preserving this hunk
        }
      }

      // Check budget
      if (currentLength > budget) {
        // Add final truncation marker if needed
        const lastLine = result[result.length - 1];
        if (!lastLine?.includes('truncated')) {
          result.push(this.config.truncationMarker);
        }
        break;
      }
    }

    keyInfoPreserved.push('file_headers');

    return {
      content: result.join('\n'),
      wasTruncated: true,
      strategy: this.name,
      keyInfoPreserved,
    };
  }
}
