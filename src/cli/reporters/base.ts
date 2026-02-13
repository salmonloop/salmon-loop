import { LoopEvent, LoopResult } from '../../core/types/index.js';

export interface SalmonReporter {
  onStart(instruction: string): void;
  onFinish(result: LoopResult): void;
  onError(error: Error): void;
  onEvent(event: LoopEvent): void;
}
