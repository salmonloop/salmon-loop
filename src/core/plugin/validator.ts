import { logger } from '../observability/logger.js';

import type { LanguagePlugin } from './interface.js';

/**
 * Validate queryPack queries at plugin load time.
 * Checks for:
 * - Valid tree-sitter query syntax (basic validation)
 * - Required capture names are present
 * - Version compatibility (if specified)
 */
export function validateQueryPack(plugin: LanguagePlugin): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const queryPack = plugin.parsing.queryPack;

  if (!queryPack) {
    return { valid: true, errors: [] };
  }

  // Validate version (if present)
  if (queryPack.version) {
    const version = queryPack.version;
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
      errors.push(`queryPack version must follow semver format (e.g., '1.0.0'), got: ${version}`);
    }
  }

  // Validate symbols.calls query
  if (queryPack.symbols?.calls) {
    const callsQuery = queryPack.symbols.calls;
    if (!callsQuery.includes('@callee')) {
      errors.push('symbols.calls query must include @callee capture');
    }
    if (!isValidQuerySyntax(callsQuery)) {
      errors.push('symbols.calls query has invalid syntax');
    }
  }

  // Validate flow.control query
  if (queryPack.flow?.control) {
    const controlQuery = queryPack.flow.control;
    const requiredCaptures = ['@branch', '@loop', '@async'];
    for (const capture of requiredCaptures) {
      if (!controlQuery.includes(capture)) {
        errors.push(`flow.control query must include ${capture} capture`);
      }
    }
    if (!isValidQuerySyntax(controlQuery)) {
      errors.push('flow.control query has invalid syntax');
    }
  }

  // Validate flow.exceptions query
  if (queryPack.flow?.exceptions) {
    const exceptionsQuery = queryPack.flow.exceptions;
    const requiredCaptures = ['@trycatch', '@throw', '@catch'];
    for (const capture of requiredCaptures) {
      if (!exceptionsQuery.includes(capture)) {
        errors.push(`flow.exceptions query must include ${capture} capture`);
      }
    }
    if (!isValidQuerySyntax(exceptionsQuery)) {
      errors.push('flow.exceptions query has invalid syntax');
    }
  }

  if (errors.length > 0) {
    logger.warn(`Plugin ${plugin.meta.id} queryPack validation failed: ${errors.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Basic tree-sitter query syntax validation.
 * Checks for balanced parentheses and basic structure.
 */
function isValidQuerySyntax(query: string): boolean {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < query.length; i++) {
    const char = query[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
      if (depth < 0) return false;
    }
  }

  return depth === 0 && !inString;
}
