import type { TaskFailure } from './model/index.js';

export type TurnStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'max_turn_requests'
  | 'refusal'
  | 'cancelled';

const MAX_TOKENS_FAILURE_CODES = new Set<string>([
  'LLM_CONTEXT_LENGTH_EXCEEDED',
  'LLM_MAX_TOKENS',
  'LLM_TOKEN_LIMIT_EXCEEDED',
]);

const MAX_TURN_REQUESTS_FAILURE_CODES = new Set<string>([
  'MAX_TURN_REQUESTS_EXCEEDED',
  'LLM_MAX_TURN_REQUESTS_EXCEEDED',
]);

export function inferTurnStopReasonFromFailure(
  failure: TaskFailure | null | undefined,
): TurnStopReason | null {
  if (!failure) return null;

  if (failure.category === 'policy') {
    return 'refusal';
  }

  if (MAX_TOKENS_FAILURE_CODES.has(failure.code)) {
    return 'max_tokens';
  }

  if (MAX_TURN_REQUESTS_FAILURE_CODES.has(failure.code)) {
    return 'max_turn_requests';
  }

  if (failure.code === 'LLM_HTTP_ABORTED') {
    return 'cancelled';
  }

  return null;
}
