import { toLlmError } from '../../src/core/llm/errors.js';

describe('toLlmError', () => {
  it('keeps provider metadata and response details', () => {
    const simulatedError = {
      name: 'AI_APICallError',
      message: 'Request failed',
      statusCode: 403,
      responseBody: '{"error":{"message":"Error: Model not available in your region"}}',
      data: {
        error: {
          message: 'Error: Model not available in your region',
        },
      },
    };

    const err = toLlmError(simulatedError, 'ai-sdk');
    expect(err.llmCode).toBe('LLM_HTTP_REQUEST_FAILED');
    expect(err.meta?.provider).toBe('ai-sdk');
    expect(err.meta?.statusCode).toBe(403);
    const genericError = 'ERR_TECHNICAL_DETAILS_HIDDEN';
    expect(err.meta?.responseBody).toContain(genericError);
    expect(err.meta?.providerMessage).toContain(genericError);
  });
});
