import { logger } from '../../observability/logger.js';

import { IDataService } from './types.js';

/**
 * Service Registry for Bifrost Architecture
 * Manages the lifecycle and discovery of asynchronous data services.
 */
export class ServiceRegistry {
  private static instance: ServiceRegistry;
  private services = new Map<string, IDataService>();

  private constructor() {}

  static getInstance(): ServiceRegistry {
    if (!ServiceRegistry.instance) {
      ServiceRegistry.instance = new ServiceRegistry();
    }
    return ServiceRegistry.instance;
  }

  /**
   * Register a data service provider
   */
  register(service: IDataService): void {
    if (this.services.has(service.id)) {
      logger.warn(`[ServiceRegistry] Overwriting existing service: ${service.id}`);
    }
    this.services.set(service.id, service);
  }

  /**
   * Get a service instance by its identifier
   */
  get(id: string): IDataService | undefined {
    return this.services.get(id);
  }

  /**
   * Check if a specific service is registered
   */
  has(id: string): boolean {
    return this.services.has(id);
  }
}

/**
 * Exported singleton instance for global access within the Grizzco module
 */
export const registry = ServiceRegistry.getInstance();
