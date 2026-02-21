export type StructuredOutputErrorCode =
  | 'SCHEMA_INVALID'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'OUTPUT_PARSE_FAILED';

export interface StructuredOutputValidationError {
  code: StructuredOutputErrorCode;
  message: string;
  details?: unknown;
}

export interface StructuredOutputValidationResult {
  ok: boolean;
  error?: StructuredOutputValidationError;
}
