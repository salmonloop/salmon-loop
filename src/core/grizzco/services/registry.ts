import { getLogger } from '../../observability/logger.js';

import { IDataService } from './types.js';

/**
 * Service Registry for Bifrost Architecture
 * Manages the lifecycle and discovery of asynchronous data services.
 */
const services = new Map<string, IDataService>();

export const registry = {
  /**
   * Register a data service provider
   */
  register(service: IDataService): void {
    if (services.has(service.id)) {
      getLogger().warn(`[ServiceRegistry] Overwriting existing service: ${service.id}`);
    }
    services.set(service.id, service);
  },

  /**
   * Get a service instance by its identifier
   */
  get(id: string): IDataService | undefined {
    return services.get(id);
  },

  /**
   * Check if a specific service is registered
   */
  has(id: string): boolean {
    return services.has(id);
  },

  /**
   * Unregister a data service by its identifier
   */
  unregister(id: string): boolean {
    return services.delete(id);
  },

  /**
   * Clear all registered services (for testing or shutdown)
   */
  clear(): void {
    services.clear();
  },

  /**
   * List all registered service IDs
   */
  list(): string[] {
    return Array.from(services.keys());
  },
};
