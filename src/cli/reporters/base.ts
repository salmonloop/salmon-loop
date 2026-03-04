import type { LoopEvent, LoopResult } from '../../core/facades/cli-reporters.js';

export interface SalmonReporter {
  onStart(instruction: string): void;
  onFinish(result: LoopResult): void;
  onError(error: Error): void;
  onEvent(event: LoopEvent): void;
}
