import { SalmonError } from '../../types/index.js';

export type ContextCacheErrorCode = 'CONTEXT_CACHE_IO' | 'CONTEXT_CACHE_CORRUPT';

export class ContextCacheError extends SalmonError {
  constructor(
    public readonly code: ContextCacheErrorCode,
    public readonly filePath: string,
    public readonly remediation: string,
    message: string,
    public readonly original?: Error,
  ) {
    super(`${code}: ${message}`, code);
    this.name = 'ContextCacheError';
  }
}
