/**
 * Utility for retrying asynchronous operations with exponential backoff.
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  jitterRatio?: number;
  retryableErrors?: (error: any) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void | Promise<void>;
  signal?: AbortSignal;
}

import { LIMITS } from '../config/limits.js';

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'signal'>> = {
  maxRetries: LIMITS.retry.api.maxAttempts,
  initialDelayMs: LIMITS.retry.api.initialDelayMs,
  maxDelayMs: LIMITS.retry.api.maxDelayMs,
  backoffFactor: 2,
  jitterRatio: 0,
  retryableErrors: () => true, // By default, retry all errors
  onRetry: async () => {},
};

function withJitter(delayMs: number, jitterRatio: number): number {
  const ratio = Number.isFinite(jitterRatio) ? Math.max(0, Math.min(1, jitterRatio)) : 0;
  if (ratio <= 0) return delayMs;
  const delta = (Math.random() * 2 - 1) * ratio;
  return Math.max(0, Math.floor(delayMs * (1 + delta)));
}

/**
 * Retries an async function with exponential backoff.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;
  let delay = opts.initialDelayMs;
  const signal = options.signal;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === opts.maxRetries || !opts.retryableErrors(error)) {
        throw error;
      }

      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      const effectiveDelay = withJitter(delay, opts.jitterRatio);
      try {
        await opts.onRetry({ attempt: attempt + 1, delayMs: effectiveDelay, error });
      } catch {
        // Ignore onRetry handler failures.
      }

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(undefined);
          signal?.removeEventListener('abort', onAbort);
        }, effectiveDelay);

        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('Operation aborted'));
          signal?.removeEventListener('abort', onAbort);
        };

        signal?.addEventListener('abort', onAbort);
      });

      delay = Math.min(delay * opts.backoffFactor, opts.maxDelayMs);
    }
  }

  throw lastError;
}

/**
 * Retries an async iterable (generator) with exponential backoff.
 * Note: Retrying a stream usually means restarting the entire stream from the beginning.
 */
export async function* withStreamRetry<T>(
  streamFactory: () => AsyncIterable<T>,
  options: RetryOptions = {},
): AsyncIterable<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;
  let delay = opts.initialDelayMs;
  const signal = options.signal;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new Error('Operation aborted');
    }

    try {
      yield* streamFactory();
      return; // Success, exit generator
    } catch (error) {
      lastError = error;

      if (attempt === opts.maxRetries || !opts.retryableErrors(error)) {
        throw error;
      }

      if (signal?.aborted) {
        throw new Error('Operation aborted');
      }

      const effectiveDelay = withJitter(delay, opts.jitterRatio);
      try {
        await opts.onRetry({ attempt: attempt + 1, delayMs: effectiveDelay, error });
      } catch {
        // Ignore onRetry handler failures.
      }

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(undefined);
          signal?.removeEventListener('abort', onAbort);
        }, effectiveDelay);

        const onAbort = () => {
          clearTimeout(timer);
          reject(new Error('Operation aborted'));
          signal?.removeEventListener('abort', onAbort);
        };

        signal?.addEventListener('abort', onAbort);
      });

      delay = Math.min(delay * opts.backoffFactor, opts.maxDelayMs);
    }
  }

  throw lastError;
}
