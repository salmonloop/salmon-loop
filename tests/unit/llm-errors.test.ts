import { describe, expect, it } from 'bun:test';

import { toLlmError } from '../../src/core/llm/errors.js';

describe('toLlmError', () => {
  it('maps provider auth failures to LLM_AUTHENTICATION_FAILED', () => {
    const simulatedError = {
      name: 'AI_APICallError',
      message: 'AppIdNoAuthError: provider rejected this application id',
    };

    const err = toLlmError(simulatedError, 'xunfei-ls');
    expect(err.llmCode).toBe('LLM_AUTHENTICATION_FAILED');
  });

  it('maps statusCode=429 to LLM_RATE_LIMITED', () => {
    const simulatedError = {
      name: 'AI_APICallError',
      message: 'rate limit reached for RPM',
      statusCode: 429,
    };

    const err = toLlmError(simulatedError, 'qiniu');
    expect(err.llmCode).toBe('LLM_RATE_LIMITED');
    expect(err.meta?.statusCode).toBe(429);
  });

  it('maps response.status=429 to LLM_RATE_LIMITED', () => {
    const simulatedError = {
      name: 'AI_APICallError',
      message: 'rate limit',
      response: { status: 429 },
    };

    const err = toLlmError(simulatedError, 'qiniu');
    expect(err.llmCode).toBe('LLM_RATE_LIMITED');
    expect(err.meta?.statusCode).toBe(429);
  });

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

  it('classifies context-length failures as LLM_CONTEXT_LENGTH_EXCEEDED', () => {
    const simulatedError = {
      name: 'AI_APICallError',
      message:
        'HTTP 400: {"error":{"message":"This model\\u0027s maximum context length is 8192 tokens."}}',
      statusCode: 400,
      responseBody:
        '{"error":{"message":"This model\\u0027s maximum context length is 8192 tokens."}}',
      data: {
        error: {
          message: "This model's maximum context length is 8192 tokens.",
        },
      },
    };

    const err = toLlmError(simulatedError, 'ai-sdk');
    expect(err.llmCode).toBe('LLM_CONTEXT_LENGTH_EXCEEDED');
    expect(err.meta?.statusCode).toBe(400);
  });
});
