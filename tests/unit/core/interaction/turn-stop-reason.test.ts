import { describe, it, expect } from 'bun:test';

import type { TaskFailure } from '../../../../src/core/interaction/model/index.js';
import { inferTurnStopReasonFromFailure } from '../../../../src/core/interaction/turn-stop-reason.js';

describe('inferTurnStopReasonFromFailure', () => {
  it('returns null if failure is null or undefined', () => {
    expect(inferTurnStopReasonFromFailure(null)).toBeNull();
    expect(inferTurnStopReasonFromFailure(undefined)).toBeNull();
  });

  it('returns refusal if failure category is policy', () => {
    const failure: TaskFailure = {
      code: 'SOME_CODE',
      message: 'Policy violated',
      category: 'policy',
    };
    expect(inferTurnStopReasonFromFailure(failure)).toBe('refusal');
  });

  it('returns max_tokens for context length exceeded codes', () => {
    const codes = ['LLM_CONTEXT_LENGTH_EXCEEDED', 'LLM_MAX_TOKENS', 'LLM_TOKEN_LIMIT_EXCEEDED'];

    for (const code of codes) {
      const failure: TaskFailure = {
        code,
        message: 'Max tokens reached',
      };
      expect(inferTurnStopReasonFromFailure(failure)).toBe('max_tokens');
    }
  });

  it('returns max_turn_requests for max turn requests exceeded codes', () => {
    const codes = ['MAX_TURN_REQUESTS_EXCEEDED', 'LLM_MAX_TURN_REQUESTS_EXCEEDED'];

    for (const code of codes) {
      const failure: TaskFailure = {
        code,
        message: 'Max turns reached',
      };
      expect(inferTurnStopReasonFromFailure(failure)).toBe('max_turn_requests');
    }
  });

  it('returns cancelled for aborted code', () => {
    const failure: TaskFailure = {
      code: 'LLM_HTTP_ABORTED',
      message: 'Request aborted',
    };
    expect(inferTurnStopReasonFromFailure(failure)).toBe('cancelled');
  });

  it('returns null for unknown failure codes and non-policy categories', () => {
    const failure: TaskFailure = {
      code: 'UNKNOWN_ERROR',
      message: 'An unknown error occurred',
      category: 'runtime',
    };
    expect(inferTurnStopReasonFromFailure(failure)).toBeNull();
  });
});
