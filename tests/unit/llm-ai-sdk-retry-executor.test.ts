import { describe, expect, it } from 'bun:test';

import {
  executeWithAiSdkRetry,
  executeWithAiSdkStreamRetry,
} from '../../src/core/llm/ai-sdk/retry-executor.js';
import { LlmError } from '../../src/core/llm/errors.js';

describe('ai-sdk retry executor', () => {
  it('returns successful unary result without altering it', async () => {
    const result = await executeWithAiSdkRetry({
      run: async () => 'ok',
      modelId: 'gpt-test',
      streamed: false,
      retryOptions: { maxRetries: 0 },
    });

    expect(result).toBe('ok');
  });

  it('wraps unary errors into LlmError', async () => {
    await expect(
      executeWithAiSdkRetry({
        run: async () => {
          throw new Error('boom');
        },
        modelId: 'gpt-test',
        streamed: false,
        retryOptions: { maxRetries: 0 },
      }),
    ).rejects.toBeInstanceOf(LlmError);
  });

  it('returns streamed values on success', async () => {
    async function* run(): AsyncIterable<string> {
      yield 'a';
      yield 'b';
    }

    const out: string[] = [];
    for await (const chunk of executeWithAiSdkStreamRetry({
      run,
      modelId: 'gpt-test',
      retryOptions: { maxRetries: 0 },
    })) {
      out.push(chunk);
    }

    expect(out).toEqual(['a', 'b']);
  });

  it('wraps stream errors into LlmError', async () => {
    async function* run(): AsyncIterable<string> {
      yield* [];
      throw new Error('stream-fail');
    }

    await expect(
      (async () => {
        for await (const _chunk of executeWithAiSdkStreamRetry({
          run,
          modelId: 'gpt-test',
          retryOptions: { maxRetries: 0 },
        })) {
          // no-op
        }
      })(),
    ).rejects.toBeInstanceOf(LlmError);
  });
});
