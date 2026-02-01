import { toLlmError } from '../../src/core/llm/errors.js';

describe('toLlmError', () => {
  it('keeps provider metadata and response details', () => {
    const simulatedError = {
      name: 'AI_APICallError',
      message: 'Request failed',
      statusCode: 403,
      responseBody: '{"error":{"message":"Model not available in your region"}}',
      data: {
        error: {
          message: 'Model not available in your region',
        },
      },
    };

    const err = toLlmError(simulatedError, 'ai-sdk');
    expect(err.llmCode).toBe('LLM_HTTP_REQUEST_FAILED');
    expect(err.meta?.provider).toBe('ai-sdk');
    expect(err.meta?.statusCode).toBe(403);
    expect(err.meta?.responseBody).toContain('Model not available');
    expect(err.meta?.providerMessage).toContain('Model not available');
  });
});
