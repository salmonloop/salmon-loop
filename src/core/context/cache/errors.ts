import { SalmonError } from '../../types/errors.js';

export type ContextCacheErrorCode =
  | 'CONTEXT_CACHE_IO'
  | 'CONTEXT_CACHE_CORRUPT'
  | 'CONTEXT_CACHE_OVERSIZE';

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
