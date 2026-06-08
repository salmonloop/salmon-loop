import { isRecord } from './serialize.js';

/**
 * Extract a human-readable error message from an unknown thrown value.
 * Handles Error instances, strings, and falls back to String(value).
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/**
 * Unwrap retry-style errors that wrap the real error in a `lastError` property.
 */
export function unwrapRetryError(err: unknown): unknown {
  if (!isRecord(err)) return err;
  if (err.lastError) return err.lastError;
  return err;
}

/**
 * Extract an HTTP-style status code from an error object.
 * Checks: meta.statusCode, statusCode, response.status
 */
export function extractStatusCode(err: unknown): number | undefined {
  const unwrapped = unwrapRetryError(err);
  if (!isRecord(unwrapped)) return undefined;

  const meta = unwrapped.meta;
  if (isRecord(meta) && typeof meta.statusCode === 'number') {
    return meta.statusCode;
  }

  if (typeof unwrapped.statusCode === 'number') return unwrapped.statusCode;

  const response = unwrapped.response;
  if (isRecord(response) && typeof response.status === 'number') {
    return response.status;
  }

  return undefined;
}

/**
 * Extract a network error code from an error object.
 * Checks: code, cause.code, meta.causeName
 */
export function extractNetworkCode(err: unknown): string | undefined {
  const unwrapped = unwrapRetryError(err);
  if (!isRecord(unwrapped)) return undefined;

  if (typeof unwrapped.code === 'string') return unwrapped.code;

  const cause = unwrapped.cause;
  if (isRecord(cause) && typeof cause.code === 'string') {
    return cause.code;
  }

  const meta = unwrapped.meta;
  if (isRecord(meta) && typeof meta.causeName === 'string') {
    return meta.causeName;
  }

  return undefined;
}

/**
 * Extract a provider name from an error object.
 * Checks: meta.provider, provider
 */
export function extractProvider(err: unknown): string | undefined {
  const unwrapped = unwrapRetryError(err);
  if (!isRecord(unwrapped)) return undefined;

  const meta = unwrapped.meta;
  if (isRecord(meta) && typeof meta.provider === 'string') {
    return meta.provider;
  }

  if (typeof unwrapped.provider === 'string') return unwrapped.provider;

  return undefined;
}
