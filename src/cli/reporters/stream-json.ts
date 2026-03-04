import { randomUUID } from 'crypto';

import {
  StreamAssembler,
  type LoopEvent,
  type LoopResult,
} from '../../core/facades/cli-reporters.js';
import { encodeNormalizedToNativeStreamLines } from '../headless/native-stream-normalized-encoder.js';
import type { StdoutWriter } from '../headless/stdout-writer.js';
import { createStdoutWriter } from '../headless/stdout-writer.js';
import {
  encodeStreamEnd,
  encodeStreamFailure,
  encodeStreamLoopEvent,
  encodeStreamResult,
  encodeStreamStart,
  getStreamExitCode,
  type StreamJsonEnvelope,
} from '../headless/stream-json-protocol.js';

import type { SalmonReporter } from './base.js';

export interface StreamJsonReporterOptions {
  mode?: 'run' | 'chat';
  repoPath?: string;
  sessionId?: string;
  now?: () => Date;
  uuid?: () => string;
  writer?: StdoutWriter;
}

export class StreamJsonReporter implements SalmonReporter {
  private readonly mode: 'run' | 'chat';
  private readonly repoPath?: string;
  private readonly sessionId: string;
  private readonly now: () => Date;
  private readonly uuid: () => string;
  private readonly writer: StdoutWriter;
  private lastTextResult: string | undefined;
  private readonly assembler = new StreamAssembler();

  constructor(options: StreamJsonReporterOptions = {}) {
    this.mode = options.mode ?? 'run';
    this.repoPath = options.repoPath;
    this.sessionId = options.sessionId ?? randomUUID();
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? randomUUID;
    this.writer = options.writer ?? createStdoutWriter();
  }

  onStart(instruction: string): void {
    this.emit(
      encodeStreamStart({
        uuid: this.uuid(),
        mode: this.mode,
        repoPath: this.repoPath,
        sessionId: this.sessionId,
        instruction,
        at: this.now(),
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
        const lines = encodeNormalizedToNativeStreamLines({
          sessionId: this.sessionId,
          uuid: this.uuid,
          event: normalizedEvent,
        });
        for (const line of lines) this.emit(line);
      }
      return;
    }

    this.emit(encodeStreamLoopEvent({ uuid: this.uuid(), sessionId: this.sessionId, event }));
  }

  onFinish(result: LoopResult): void {
    if (result.authorizationSummary) {
      const at = this.now();
      this.emit(
        encodeStreamLoopEvent({
          uuid: this.uuid(),
          sessionId: this.sessionId,
          event: {
            type: 'authorization.summary',
            stage: 'final',
            summary: result.authorizationSummary,
            timestamp: at,
          },
        }),
      );
    }

    const at = this.now();
    const resultLine = encodeStreamResult({
      uuid: this.uuid(),
      sessionId: this.sessionId,
      loopResult: result,
      at,
      resultText: this.lastTextResult,
    });
    this.emit(resultLine);

    const exitCode = getStreamExitCode(result);
    this.emit(
      encodeStreamEnd({
        uuid: this.uuid(),
        sessionId: this.sessionId,
        at: this.now(),
        success: Boolean(result.success),
        exitCode,
      }),
    );
  }

  onError(error: Error): void {
    this.emit(
      encodeStreamFailure({
        uuid: this.uuid(),
        sessionId: this.sessionId,
        at: this.now(),
        message: error.message,
        name: error.name,
        stack: error.stack,
      }),
    );
    this.emit(
      encodeStreamEnd({
        uuid: this.uuid(),
        sessionId: this.sessionId,
        at: this.now(),
        success: false,
        exitCode: 1,
      }),
    );
  }

  private emit(line: StreamJsonEnvelope): void {
    this.writer.writeJsonLine(line);
  }
}
