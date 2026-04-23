export const RECOVERABLE_TOOL_INPUT_ERROR_CODES = [
  'INVALID_INPUT',
  'INVALID_TOOL_ARGUMENTS_JSON',
  'MALFORMED_TOOL_CALL',
] as const;

const RECOVERABLE_TOOL_INPUT_ERROR_CODE_SET = new Set<string>(RECOVERABLE_TOOL_INPUT_ERROR_CODES);

export function isRecoverableToolInputErrorCode(code: unknown): code is string {
  return typeof code === 'string' && RECOVERABLE_TOOL_INPUT_ERROR_CODE_SET.has(code);
}
