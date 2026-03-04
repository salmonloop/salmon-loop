import type {
  CanonicalResponsesEvent,
  LoopEvent,
  LoopResult,
} from '../../core/facades/cli-reporters.js';
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
  private readonly encoder: OpenAiStreamEncoder;
  private sawOutputTextDelta = false;
  private reportText: { text: string; timestamp: Date } | null = null;

  constructor(options: OpenAiStreamReporterOptions = {}) {
    this.writer = options.writer ?? createStdoutWriter();
    this.encoder = new OpenAiStreamEncoder(options);
  }

  onStart(_instruction: string): void {
    for (const line of this.encoder.start()) this.emit(line);
  }

  onEvent(event: LoopEvent): void {
    if (
      event.type === 'llm.output' &&
      event.kind === 'assistant_message' &&
      event.step === 'REPORT'
    ) {
      this.reportText = { text: event.content, timestamp: event.timestamp };
      return;
    }

    if (event.type === 'llm.responses.event') {
      if (event.event.type === 'response.output_text.delta') this.sawOutputTextDelta = true;
      const lines = this.encoder.pushResponsesEvent({
        streamId: event.streamId,
        event: event.event,
      });
      for (const line of lines) this.emit(line);
      return;
    }
  }

  onFinish(result: LoopResult): void {
    const ok = Boolean(result.success);
    const message = result.reason || (ok ? undefined : 'Unknown error');
    const code = result.errorCode ?? null;

    if (!this.sawOutputTextDelta && this.reportText) {
      const events = createReportOnlyCanonicalEvents(this.reportText.text);
      for (const event of events) {
        const lines = this.encoder.pushResponsesEvent({ streamId: 'report', event });
        for (const line of lines) this.emit(line);
      }
    }

    for (const line of this.encoder.complete({ ok, message, code })) this.emit(line);
  }

  onError(error: Error): void {
    for (const line of this.encoder.crash(error)) this.emit(line);
  }

  private emit(value: unknown): void {
    this.writer.writeJsonLine(value);
  }
}

function createReportOnlyCanonicalEvents(text: string): CanonicalResponsesEvent[] {
  return [
    { type: 'response.output_text.delta', delta: text },
    { type: 'response.output_text.done', text },
    {
      type: 'response.content_part.done',
      part: { type: 'output_text', text, annotations: [] },
    },
    {
      type: 'response.output_item.done',
      item: { type: 'message', role: 'assistant', content: [] },
    },
  ];
}
