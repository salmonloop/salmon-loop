import { getLogger } from '../core/observability/logger.js';

export function reportCliCrash(err: unknown): void {
  getLogger().error('CLI execution crashed', err, true);
}
