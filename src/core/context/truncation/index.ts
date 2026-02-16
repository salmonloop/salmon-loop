/**
 * Semantic truncation module.
 *
 * Provides type-aware truncation for tool outputs.
 *
 * @example
 * ```typescript
 * import { SemanticTruncator, truncateOutput } from './truncation/index.js';
 *
 * // Using convenience function
 * const result = truncateOutput(output, 4000, 'error');
 *
 * // Using class
 * const truncator = new SemanticTruncator();
 * const result = truncator.truncate(output, 4000);
 * console.log(result.keyInfoPreserved); // ['error_messages', 'stack_trace_top']
 * ```
 */

export { SemanticTruncator, getSemanticTruncator, truncateOutput } from './semantic-truncator.js';
export { detectOutputType, detectOutputTypeWithHint } from './type-detector.js';

export type {
  OutputType,
  TruncatedOutput,
  TruncationStrategy,
  TruncationConfig,
  TypeDetectionResult,
} from './types.js';

export { DEFAULT_TRUNCATION_CONFIG } from './types.js';

export {
  ErrorStackStrategy,
  JsonStrategy,
  GitDiffStrategy,
  LogStrategy,
  TestResultStrategy,
  GenericStrategy,
} from './strategies/index.js';
