import { StreamAssembler } from '../../core/streaming/stream-assembler.js';
import type { LoopEvent, LoopResult } from '../../core/types/index.js';
import {
  OpenAiStreamEncoder,
  type OpenAiStreamEncoderOptions,
} from '../headless/openai-stream-encoder.js';
import type { StdoutWriter } from '../headless/stdout-writer.js';
import { createStdoutWriter } from '../headless/stdout-writer.js';

import type { SalmonReporter } from './base.js';

export interface OpenAiStreamReporterOptions extends OpenAiStreamEncoderOptions {
  writer?: StdoutWriter;
}

export class OpenAiStreamReporter implements SalmonReporter {
  private readonly writer: StdoutWriter;
  private readonly assembler = new StreamAssembler();
  private readonly encoder: OpenAiStreamEncoder;

  constructor(options: OpenAiStreamReporterOptions = {}) {
    this.writer = options.writer ?? createStdoutWriter();
    this.encoder = new OpenAiStreamEncoder(options);
  }

  onStart(_instruction: string): void {
    for (const line of this.encoder.start()) this.emit(line);
  }

  onEvent(event: LoopEvent): void {
    if (
      event.type !== 'tool.call.start' &&
      event.type !== 'tool.call.end' &&
      event.type !== 'llm.stream.delta' &&
      event.type !== 'llm.stream.end'
    ) {
      return;
    }

    const normalized = this.assembler.push(event);
    for (const normalizedEvent of normalized) {
      const lines = this.encoder.push(normalizedEvent);
      for (const line of lines) this.emit(line);
    }
  }

  onFinish(result: LoopResult): void {
    const ok = Boolean(result.success);
    const message = result.reason || (ok ? undefined : 'Unknown error');
    const code = result.errorCode ?? null;

    for (const line of this.encoder.complete({ ok, message, code })) this.emit(line);
  }

  onError(error: Error): void {
    for (const line of this.encoder.crash(error)) this.emit(line);
  }

  private emit(value: unknown): void {
    this.writer.writeJsonLine(value);
  }
}
