import { logger } from '../../observability/logger.js';
import { AstValidateCtx } from '../engine/pipeline/types.js';

import { IDataService } from './types.js';

/**
 * Caching Decorator for IDataService.
 * Supports path-aware caching to handle both global (e.g. Git Config)
 * and file-specific (e.g. Remote Locks) data requirements.
 */
export class CachedService implements IDataService {
  private cache = new Map<string, any>();
  private inFlight = new Map<string, Promise<any>>();

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
    const pending = this.inFlight.get(key);
    if (pending) {
      return pending;
    }

    logger.debug(`[CachedService] Cache miss for ${this.id} (Scope: ${key}), fetching...`);
    const request = this.delegate
      .fetch(ctx, filePath)
      .then((result) => {
        this.cache.set(key, result);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, request);
    return request;
  }
}
