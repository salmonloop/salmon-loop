import { randomUUID } from 'crypto';

import type { LoopEvent, LoopResult } from '../../core/types/index.js';
import {
  encodeStreamEnd,
  encodeStreamFailure,
  encodeStreamLineFromLoopEvent,
  encodeStreamResult,
  encodeStreamStart,
  getStreamExitCode,
  type StreamJsonLine,
} from '../headless/stream-json-protocol.js';

import type { SalmonReporter } from './base.js';

export interface StreamJsonReporterOptions {
  mode?: 'run' | 'chat';
  repoPath?: string;
  sessionId?: string;
  now?: () => Date;
  write?: (chunk: string) => boolean;
}

export class StreamJsonReporter implements SalmonReporter {
  private readonly mode: 'run' | 'chat';
  private readonly repoPath?: string;
  private readonly sessionId: string;
  private readonly now: () => Date;
  private readonly write: (chunk: string) => boolean;
  private lastTextResult: string | undefined;

  constructor(options: StreamJsonReporterOptions = {}) {
    this.mode = options.mode ?? 'run';
    this.repoPath = options.repoPath;
    this.sessionId = options.sessionId ?? randomUUID();
    this.now = options.now ?? (() => new Date());
    this.write = options.write ?? ((chunk) => process.stdout.write(chunk));
  }

  onStart(instruction: string): void {
    this.emit(
      encodeStreamStart({
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
    this.emit(encodeStreamLineFromLoopEvent({ sessionId: this.sessionId, event }));
  }

  onFinish(result: LoopResult): void {
    if (result.authorizationSummary) {
      const at = this.now();
      this.emit(
        encodeStreamLineFromLoopEvent({
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
      sessionId: this.sessionId,
      loopResult: result,
      at,
      resultText: this.lastTextResult,
    });
    this.emit(resultLine);

    const exitCode = getStreamExitCode(result);
    this.emit(
      encodeStreamEnd({
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
        sessionId: this.sessionId,
        at: this.now(),
        message: error.message,
        name: error.name,
        stack: error.stack,
      }),
    );
  }

  private emit(line: StreamJsonLine): void {
    this.write(JSON.stringify(line) + '\n');
  }
}
