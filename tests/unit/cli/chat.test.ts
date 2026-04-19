import { describe, expect, it } from 'bun:test';

import { isContextOverflowError } from '../../../src/core/llm/errors.js';
import { LlmError } from '../../../src/core/llm/errors.js';

describe('isContextOverflowError', () => {
  it('identifies LlmError with correct code', () => {
    const error = new LlmError('test', 'LLM_CONTEXT_LENGTH_EXCEEDED');
    expect(isContextOverflowError(error)).toBe(true);
  });

  it('identifies errors with context overflow messages', () => {
    expect(isContextOverflowError(new Error('maximum context length exceeded'))).toBe(true);
    expect(isContextOverflowError(new Error('Prompt is too long!'))).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isContextOverflowError(new Error('Something went wrong'))).toBe(false);
    expect(isContextOverflowError({ message: 'Other error' })).toBe(false);
    expect(isContextOverflowError(null)).toBe(false);
  });
});
