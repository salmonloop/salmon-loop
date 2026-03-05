import { DEFAULT_AST_VALIDATION_STRICTNESS } from '../defaults.js';
import type { AstValidationStrictness, ConfigFileV1 } from '../types.js';

export function resolveAstValidationStrictness(raw?: ConfigFileV1): AstValidationStrictness {
  const strictness = raw?.astValidation?.strictness;
  if (strictness === 'strict' || strictness === 'lenient') return strictness;
  return DEFAULT_AST_VALIDATION_STRICTNESS;
}
