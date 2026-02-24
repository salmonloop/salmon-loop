import { describe, it, expect } from 'bun:test';

import { toLlmError } from '../../src/core/llm/errors.js';

describe('AI SDK Error Leakage', () => {
  it('should not leak Zod error details in causeMessage', () => {
    // Simulate a typical AI SDK Zod validation error structure
    const fakeZodError = {
      name: 'AI_TypeValidationError',
      message: 'Invalid input',
      value: { approved: undefined },
      cause: [
        {
          code: 'invalid_type',
          expected: 'boolean',
          path: ['approved'],
          message: 'Invalid input: expected boolean, received undefined',
        },
      ],
    };

    // Set Symbol to simulate AI SDK internal marker
    (fakeZodError as any)[Symbol.for('vercel.ai.error.AI_TypeValidationError')] = true;

    const result = toLlmError(fakeZodError, 'openai');

    // 1. Verify that the main message is sanitized (should be unified text from locales)
    // Note: This needs to assert against the actual content of text.llm.validationFailed
    expect(result.llmCode).toBe('LLM_VALIDATION_FAILED');

    // 2. Core verification: meta.causeMessage must NOT contain sensitive field "approved"
    // If leaked, this test will fail
    const leakedContent = result.meta?.causeMessage || '';

    expect(leakedContent).not.toContain('approved');
    expect(leakedContent).not.toContain('invalid_type');
    expect(leakedContent).toContain('ERR_TECHNICAL_DETAILS_HIDDEN');
  });
});
