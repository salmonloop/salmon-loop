import { configFileV1Schema, zodIssueToConfigError } from './schema.js';
import type { ConfigFileV1 } from './types.js';

/**
 * Validate and normalize a raw config file object against the ConfigFileV1 schema.
 *
 * Uses Zod for declarative validation with full error code mapping.
 * First-error-wins semantics: only the first validation issue is reported.
 */
export function validateConfigFileV1(input: unknown): ConfigFileV1 {
  const result = configFileV1Schema.safeParse(input);
  if (result.success) return result.data as ConfigFileV1;
  throw zodIssueToConfigError(result.error.issues[0]);
}
