function unwrapRetryError(err: unknown): unknown {
  if (!err || typeof err !== 'object') return err;
  const candidate = err as Record<string, unknown>;
  if (candidate.lastError) return candidate.lastError;
  return err;
}

function findStatusCode(err: unknown): number | undefined {
  const unwrapped = unwrapRetryError(err);
  if (!unwrapped || typeof unwrapped !== 'object') return undefined;
  const obj = unwrapped as Record<string, unknown>;
  const direct = obj.statusCode;
  if (typeof direct === 'number' && Number.isFinite(direct)) return direct;

  const response = obj.response;
  if (response && typeof response === 'object') {
    const status = (response as any).status;
    if (typeof status === 'number' && Number.isFinite(status)) return status;
  }

  return undefined;
}

function findNetworkCode(err: unknown): string | undefined {
  const unwrapped = unwrapRetryError(err);
  if (!unwrapped || typeof unwrapped !== 'object') return undefined;
  const obj = unwrapped as Record<string, unknown>;

  const code = obj.code;
  if (typeof code === 'string') return code;

  const cause = (obj as any).cause;
  if (cause && typeof cause === 'object' && typeof (cause as any).code === 'string') {
    return (cause as any).code;
  }

  return undefined;
}

function isAbortLikeError(err: unknown): boolean {
  const unwrapped = unwrapRetryError(err);
  const name = unwrapped instanceof Error ? unwrapped.name : '';
  const msg = String((unwrapped as any)?.message ?? unwrapped).toLowerCase();
  return name === 'AbortError' || msg.includes('aborted');
}

export function classifyRetryableApiError(err: unknown): {
  retryable: boolean;
  reason: string;
  statusCode?: number;
  networkCode?: string;
} {
  if (isAbortLikeError(err)) return { retryable: false, reason: 'aborted' };

  const statusCode = findStatusCode(err);
  const networkCode = findNetworkCode(err);
  const msg = String((unwrapRetryError(err) as any)?.message ?? err).toLowerCase();

  if (statusCode === 408) return { retryable: true, reason: 'timeout', statusCode, networkCode };
  if (statusCode === 429) return { retryable: true, reason: 'rate_limit', statusCode, networkCode };
  if (typeof statusCode === 'number') {
    const retryable5xx = new Set([502, 503, 504, 521, 522, 524, 529]);
    if (retryable5xx.has(statusCode)) {
      return { retryable: true, reason: 'server_error', statusCode, networkCode };
    }
  }

  if (msg.includes('timeout')) {
    return { retryable: true, reason: 'timeout', statusCode, networkCode };
  }
  if (msg.includes('rate limit')) {
    return { retryable: true, reason: 'rate_limit', statusCode, networkCode };
  }
  if (msg.includes('overloaded')) {
    return { retryable: true, reason: 'overloaded', statusCode, networkCode };
  }

  if (typeof networkCode === 'string') {
    const normalized = networkCode.toUpperCase();
    if (
      normalized === 'ECONNRESET' ||
      normalized === 'ETIMEDOUT' ||
      normalized === 'EAI_AGAIN' ||
      normalized === 'ENOTFOUND' ||
      normalized === 'ECONNREFUSED'
    ) {
      return { retryable: true, reason: 'network', statusCode, networkCode: normalized };
    }
  }

  return { retryable: false, reason: 'non_retryable', statusCode, networkCode };
}
