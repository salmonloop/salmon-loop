import type { FlowMode, LoopOptions } from '../../types/runtime.js';

import type { AstValidationStrictness } from './AstValidationService.js';

export interface AstValidationPolicyInput {
  mode: FlowMode;
  options?: Pick<LoopOptions, 'astValidation'>;
}

export function resolveAstValidationStrictness(
  input: AstValidationPolicyInput,
): AstValidationStrictness {
  const configuredStrictness = input.options?.astValidation?.strictness;
  if (configuredStrictness === 'strict' || configuredStrictness === 'lenient') {
    return configuredStrictness;
  }

  // Default policy:
  // - debug mode emphasizes containment and safety guarantees
  // - other modes prefer best-effort compatibility
  return input.mode === 'debug' ? 'strict' : 'lenient';
}
