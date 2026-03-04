import { randomUUID } from 'crypto';

import {
  StreamAssembler,
  type LoopEvent,
  type LoopResult,
} from '../../core/facades/cli-reporters.js';
import { encodeNormalizedToAnthropicStreamLines } from '../headless/anthropic-stream-normalized-encoder.js';
import {
  encodeAnthropicEnd,
  encodeAnthropicError,
  encodeAnthropicResult,
  encodeAnthropicStart,
  type AnthropicStreamLine,
} from '../headless/anthropic-stream-protocol.js';
import type { StdoutWriter } from '../headless/stdout-writer.js';
import { createStdoutWriter } from '../headless/stdout-writer.js';

import type { SalmonReporter } from './base.js';

export interface AnthropicStreamReporterOptions {
  mode?: 'run' | 'chat';
  repoPath?: string;
  sessionId?: string;
  writer?: StdoutWriter;
}

export class AnthropicStreamReporter implements SalmonReporter {
  private readonly mode: 'run' | 'chat';
  private readonly repoPath?: string;
  private readonly sessionId: string;
  private readonly writer: StdoutWriter;

  private lastTextResult: string | undefined;
  private readonly assembler = new StreamAssembler();

  constructor(options: AnthropicStreamReporterOptions = {}) {
    this.mode = options.mode ?? 'run';
    this.repoPath = options.repoPath;
    this.sessionId = options.sessionId ?? randomUUID();
    this.writer = options.writer ?? createStdoutWriter();
  }

  onStart(instruction: string): void {
    this.emit(
      encodeAnthropicStart({
        sessionId: this.sessionId,
        mode: this.mode,
        repoPath: this.repoPath,
        instruction,
      }),
    );
  }

  onEvent(event: LoopEvent): void {
    if (
      event.type === 'llm.output' &&
      event.kind === 'assistant_message' &&
      event.step === 'REPORT'
    ) {
      this.lastTextResult = event.content;
    }

    if (
      event.type === 'tool.call.start' ||
      event.type === 'tool.call.end' ||
      event.type === 'llm.responses.event' ||
      event.type === 'llm.stream.delta' ||
      event.type === 'llm.stream.end'
    ) {
      const normalized = this.assembler.push(event);
      for (const normalizedEvent of normalized) {
        const lines = encodeNormalizedToAnthropicStreamLines({
          sessionId: this.sessionId,
          event: normalizedEvent,
        });
        for (const line of lines) this.emit(line);
      }
      return;
    }
  }

  onFinish(result: LoopResult): void {
    this.emit(
      encodeAnthropicResult({
        sessionId: this.sessionId,
        loopResult: result,
        resultText: this.lastTextResult,
      }),
    );
    this.emit(
      encodeAnthropicEnd({
        sessionId: this.sessionId,
        loopResult: result,
      }),
    );
  }

  onError(error: Error): void {
    this.emit(
      encodeAnthropicError({
        sessionId: this.sessionId,
        message: error.message,
        name: error.name,
        stack: error.stack,
      }),
    );
    this.emit(
      encodeAnthropicEnd({
        sessionId: this.sessionId,
        loopResult: { success: false, reason: error.message } as any,
      }),
    );
  }

  private emit(line: AnthropicStreamLine): void {
    this.writer.writeJsonLine(line);
  }
}
