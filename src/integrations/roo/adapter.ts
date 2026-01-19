import { Logger } from '../../core/logger.js';
import { runSalmonLoop, type LoopOptions, type LoopEvent } from '../../index.js';

/**
 * Roo Code Adapter for SalmonLoop.
 *
 * This adapter provides a clean interface for Roo Code to interact with SalmonLoop.
 * It translates SalmonLoop events into a format that can be easily consumed by the host.
 */
export class RooSalmonAdapter {
  private logger: Logger;

  constructor() {
    this.logger = new Logger({ prefix: '[SalmonLoop]' });
  }

  /**
   * Runs the SalmonLoop with the given options and pipes events to the provided handler.
   *
   * @param options - SalmonLoop options.
   * @param onEvent - Optional event handler for the host to update UI.
   */
  async execute(options: Omit<LoopOptions, 'onEvent'>, onEvent?: (event: LoopEvent) => void) {
    if (options.verbose) {
      this.logger.setVerbose(options.verbose);
    }

    return runSalmonLoop({
      ...options,
      onEvent: (event) => {
        // Pipe event to host
        if (onEvent) {
          onEvent(event);
        }

        // Log to console for debugging if needed
        this.logEvent(event);
      },
    });
  }

  private logEvent(event: LoopEvent) {
    switch (event.type) {
      case 'phase.start':
        this.logger.info(`Starting phase: ${event.phase}`);
        break;
      case 'phase.end':
        this.logger.info(`Finished phase: ${event.phase} (Success: ${event.success})`);
        break;
      case 'diff.meta':
        this.logger.info(`Files to change: ${event.changedFiles.join(', ')}`);
        break;
      case 'retry':
        this.logger.warn(
          `Retrying (From Attempt ${event.fromAttempt} to ${event.toAttempt}). Reason: ${event.reason}`,
        );
        break;
      case 'log':
        if (event.level === 'error') {
          this.logger.error(event.message);
        } else if (event.level === 'warn') {
          this.logger.warn(event.message);
        } else if (event.level === 'trace') {
          this.logger.trace(event.message);
        } else if (event.level === 'debug') {
          this.logger.debug(event.message);
        } else {
          this.logger.info(event.message);
        }
        break;
    }
  }
}
