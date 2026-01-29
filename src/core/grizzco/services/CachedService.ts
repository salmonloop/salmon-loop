import { logger } from '../../logger.js';
import { AstValidateCtx } from '../types.js';

import { IDataService } from './types.js';

/**
 * Caching Decorator for IDataService.
 * Supports path-aware caching to handle both global (e.g. Git Config)
 * and file-specific (e.g. Remote Locks) data requirements.
 */
export class CachedService implements IDataService {
  private cache = new Map<string, any>();

  constructor(private delegate: IDataService) {}

  get id(): string {
    return this.delegate.id;
  }

  async fetch(ctx: AstValidateCtx, filePath?: string): Promise<any> {
    // Composite key: workspace + filePath (if provided)
    const scope = ctx.workspace?.workPath || 'global';
    const key = filePath ? `${scope}:${filePath}` : scope;

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    logger.debug(`[CachedService] Cache miss for ${this.id} (Scope: ${key}), fetching...`);
    const result = await this.delegate.fetch(ctx, filePath);

    this.cache.set(key, result);
    return result;
  }
}
