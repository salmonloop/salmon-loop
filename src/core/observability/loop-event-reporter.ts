import type { LoopEvent } from '../types/index.js';

import type { LogReporter } from './logger.js';
import { sanitizeUiLogMessage } from './ui-log-sanitize.js';

export interface LoopEventReporterOptions {
  source?: string;
}

function mapLevel(level: string): Extract<LoopEvent, { type: 'log' }>['level'] {
  switch (level) {
    case 'error':
      return 'error';
    case 'warn':
    case 'degraded':
      return 'warn';
    case 'debug':
      return 'debug';
    case 'trace':
      return 'trace';
    // success/log/info/bold/cyan/dim/step/audit => info
    default:
      return 'info';
  }
}

/**
 * A GUI-safe reporter: emits structured `LoopEvent` log events without touching stdout/stderr.
 * This avoids Ink console patching paths and enforces sanitization/limits at the core boundary.
 */
export class LoopEventReporter implements LogReporter {
  private source: string;

  constructor(
    private emit: (event: LoopEvent) => void,
    options?: LoopEventReporterOptions,
  ) {
    this.source = options?.source ?? 'core.logger';
  }

  log(level: string, message: string): void {
    const mapped = mapLevel(level);
    this.emit({
      type: 'log',
      level: mapped,
      source: this.source,
      message: sanitizeUiLogMessage(message, mapped),
      timestamp: new Date(),
    });
  }

  clear(): void {
    // No-op: GUI controls rendering.
  }
}
