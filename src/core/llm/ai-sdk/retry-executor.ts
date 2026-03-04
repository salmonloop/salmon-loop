import { toLlmError } from '../errors.js';
import type { RetryOptions } from '../retry-utils.js';
import { withRetry, withStreamRetry } from '../retry-utils.js';

import { createAiSdkRetryLogger, isRetryableAiSdkError } from './request-runtime.js';

const DEFAULT_AI_SDK_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 2,
  jitterRatio: 0.2,
};

export async function executeWithAiSdkRetry<T>(params: {
  run: () => Promise<T>;
  signal?: AbortSignal;
  modelId: string;
  streamed: boolean;
  retryOptions?: RetryOptions;
}): Promise<T> {
  const options: RetryOptions = {
    ...DEFAULT_AI_SDK_RETRY_OPTIONS,
    ...params.retryOptions,
    signal: params.signal,
    retryableErrors: isRetryableAiSdkError,
    onRetry: createAiSdkRetryLogger({ modelId: params.modelId, streamed: params.streamed }),
  };

  try {
    return await withRetry(params.run, options);
  } catch (error) {
    throw toLlmError(error, 'ai-sdk');
  }
}

export async function* executeWithAiSdkStreamRetry<T>(params: {
  run: () => AsyncIterable<T>;
  signal?: AbortSignal;
  modelId: string;
  retryOptions?: RetryOptions;
}): AsyncIterable<T> {
  const options: RetryOptions = {
    ...DEFAULT_AI_SDK_RETRY_OPTIONS,
    ...params.retryOptions,
    signal: params.signal,
    retryableErrors: isRetryableAiSdkError,
    onRetry: createAiSdkRetryLogger({ modelId: params.modelId, streamed: true }),
  };

  try {
    yield* withStreamRetry(params.run, options);
  } catch (error) {
    throw toLlmError(error, 'ai-sdk');
  }
}
