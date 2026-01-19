import { runSalmonLoop, type LoopOptions, type LoopEvent } from '../../index.js';

/**
 * Roo Code Adapter for SalmonLoop.
 * 
 * This adapter provides a clean interface for Roo Code to interact with SalmonLoop.
 * It translates SalmonLoop events into a format that can be easily consumed by the host.
 */
export class RooSalmonAdapter {
  /**
   * Runs the SalmonLoop with the given options and pipes events to the provided handler.
   * 
   * @param options - SalmonLoop options.
   * @param onEvent - Optional event handler for the host to update UI.
   */
  async execute(
    options: Omit<LoopOptions, 'onEvent'>,
    onEvent?: (event: LoopEvent) => void
  ) {
    return runSalmonLoop({
      ...options,
      onEvent: (event) => {
        // Pipe event to host
        if (onEvent) {
          onEvent(event);
        }
        
        // Log to console for debugging if needed
        this.logEvent(event);
      }
    });
  }

  private logEvent(event: LoopEvent) {
    switch (event.type) {
      case 'phase.start':
        console.log(`[SalmonLoop] Starting phase: ${event.phase}`);
        break;
      case 'phase.end':
        console.log(`[SalmonLoop] Finished phase: ${event.phase} (Success: ${event.success})`);
        break;
      case 'diff.meta':
        console.log(`[SalmonLoop] Files to change: ${event.changedFiles.join(', ')}`);
        break;
      case 'retry':
        console.log(`[SalmonLoop] Retrying (From Attempt ${event.fromAttempt} to ${event.toAttempt}). Reason: ${event.reason}`);
        break;
      case 'log':
        if (event.level === 'error') {
          console.error(`[SalmonLoop] ${event.message}`);
        } else {
          console.log(`[SalmonLoop] ${event.message}`);
        }
        break;
    }
  }
}
