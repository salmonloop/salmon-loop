/**
 * Output type detection.
 *
 * Analyzes output content to determine the most appropriate
 * truncation strategy.
 */

import type { OutputType, TypeDetectionResult } from './types.js';

/**
 * Detection patterns for each output type.
 */
const DETECTION_PATTERNS: Record<OutputType, RegExp[]> = {
  error_stack: [
    /^\s*Error:\s*.+$/m, // Error: message
    /^\s+at\s+.+\(.+\)$/m, // at function (file:line:col)
    /^\s*TypeError:\s*.+$/m,
    /^\s*ReferenceError:\s*.+$/m,
    /^\s*SyntaxError:\s*.+$/m,
    /^\s*RuntimeError:\s*.+$/m,
    /stack trace:/i,
    /^\s*\w+Error:/m, // Any *Error:
  ],

  git_diff: [
    /^diff --git\s+a\/.+\s+b\/.+$/m,
    /^index\s+[a-f0-9]+\.\.[a-f0-9]+/m,
    /^---\s+a\//m,
    /^\+\+\+\s+b\//m,
    /^@@\s+-\d+,?\d*\s+\+\d+,?\d*\s+@@/m,
  ],

  json: [
    /^\s*\{[\s\S]*\}\s*$/, // Object
    /^\s*\[[\s\S]*\]\s*$/, // Array
  ],

  test_result: [
    /\d+\s+(passed|failed|skipped)/i,
    /FAIL\s*[(:]/i,
    /PASS\s*[(:]/i,
    /✓|✗|✅|❌/,
    /Test\s+\d+:/i,
    /FAILURES:/i,
    /\d+\s+tests?\s+(passed|failed)/i,
  ],

  log: [
    /^\s*(ERROR|WARN|INFO|DEBUG|TRACE|FATAL)\s*[:[\]|]/m,
    /^\s*\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/m, // Timestamp
    /^\s*\[\d{4}-\d{2}-\d{2}/m, // [YYYY-MM-DD
    /log\s*(level|file):/i,
  ],

  generic: [],
};

/**
 * Detect the output type based on content analysis.
 *
 * @param output - Raw output string
 * @returns Detection result with type and confidence
 */
export function detectOutputType(output: string): TypeDetectionResult {
  if (!output || output.trim().length === 0) {
    return { type: 'generic', confidence: 1.0 };
  }

  const scores: Map<OutputType, number> = new Map();

  for (const [type, patterns] of Object.entries(DETECTION_PATTERNS) as [OutputType, RegExp[]][]) {
    let matchCount = 0;
    for (const pattern of patterns) {
      if (pattern.test(output)) {
        matchCount++;
      }
    }

    if (matchCount > 0) {
      // Score based on number of matching patterns
      const score = matchCount / patterns.length;
      scores.set(type, score);
    }
  }

  // Find the type with highest score
  let bestType: OutputType = 'generic';
  let bestScore = 0;

  for (const [type, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  // Special handling for JSON - verify it parses
  if (bestType === 'json') {
    try {
      JSON.parse(output);
    } catch {
      // Not valid JSON, downgrade to generic
      bestType = 'generic';
      bestScore = 0;
    }
  }

  return {
    type: bestType,
    confidence: bestScore,
  };
}

/**
 * Detect output type with hint.
 * Hint can override detection when explicitly provided.
 *
 * @param output - Raw output string
 * @param hint - Optional type hint (e.g., from tool name)
 * @returns Detection result
 */
export function detectOutputTypeWithHint(output: string, hint?: string): TypeDetectionResult {
  // If hint is provided, try to map it
  if (hint) {
    const normalizedHint = hint.toLowerCase().trim();

    // Map common hints to types
    const hintMap: Record<string, OutputType> = {
      error: 'error_stack',
      exception: 'error_stack',
      stacktrace: 'error_stack',
      diff: 'git_diff',
      git: 'git_diff',
      json: 'json',
      test: 'test_result',
      tests: 'test_result',
      verify: 'test_result',
      log: 'log',
      logs: 'log',
    };

    for (const [key, type] of Object.entries(hintMap)) {
      if (normalizedHint.includes(key)) {
        return { type, confidence: 1.0 };
      }
    }
  }

  // Fall back to content-based detection
  return detectOutputType(output);
}
