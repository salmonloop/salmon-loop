import { logger } from './logger.js';

export function logIgnoredError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  logger.trace(`[IgnoredError] ${context}: ${message}`);
}
