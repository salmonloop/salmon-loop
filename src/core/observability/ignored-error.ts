import { getLogger } from './logger.js';

export function logIgnoredError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  getLogger().trace(`[IgnoredError] ${context}: ${message}`);
}
