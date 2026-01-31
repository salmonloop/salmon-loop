/**
 * Utility for retrying asynchronous operations with exponential backoff.
 */
export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  retryableErrors?: (error: any) => boolean;
  signal?: AbortSignal;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'signal'>> = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 10000,
  backoffFactor: 2,
  retryableErrors: () => true, // By default, retry all errors
};

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

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(undefined);
          signal?.removeEventListener('abort', onAbort);
        }, delay);

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

      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          resolve(undefined);
          signal?.removeEventListener('abort', onAbort);
        }, delay);

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
