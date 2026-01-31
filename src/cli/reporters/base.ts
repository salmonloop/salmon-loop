import { LoopEvent, LoopResult, LLMStreamChunk } from '../../core/types.js';

export interface SalmonReporter {
  onStart(instruction: string): void;
  onFinish(result: LoopResult): void;
  onError(error: Error): void;
  onEvent(event: LoopEvent): void;
  onStreamChunk(chunk: LLMStreamChunk): void;
}
