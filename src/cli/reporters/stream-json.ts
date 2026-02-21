import { randomUUID } from 'crypto';

import type { LoopEvent, LoopResult } from '../../core/types/index.js';
import {
  encodeStreamEnd,
  encodeStreamEvent,
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
  write?: (chunk: string) => boolean;
}

type StreamState = {
  messageId: string;
  started: boolean;
  contentBlockOpen: boolean;
};

export class StreamJsonReporter implements SalmonReporter {
  private readonly mode: 'run' | 'chat';
  private readonly repoPath?: string;
  private readonly sessionId: string;
  private readonly now: () => Date;
  private readonly write: (chunk: string) => boolean;
  private lastTextResult: string | undefined;
  private readonly streamStates = new Map<string, StreamState>();

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
        uuid: randomUUID(),
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

    if (event.type === 'llm.stream.delta') {
      this.emitStreamPreludeIfNeeded(event.streamId, event.timestamp);
      this.emit(
        encodeStreamEvent({
          uuid: randomUUID(),
          sessionId: this.sessionId,
          at: event.timestamp,
          event: {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: event.content },
          },
        }),
      );
      return;
    }

    if (event.type === 'llm.stream.end') {
      this.emitStreamPreludeIfNeeded(event.streamId, event.timestamp);

      const state = this.streamStates.get(event.streamId);
      if (state?.contentBlockOpen) {
        this.emit(
          encodeStreamEvent({
            uuid: randomUUID(),
            sessionId: this.sessionId,
            at: event.timestamp,
            event: { type: 'content_block_stop', index: 0 },
          }),
        );
        state.contentBlockOpen = false;
      }

      this.emit(
        encodeStreamEvent({
          uuid: randomUUID(),
          sessionId: this.sessionId,
          at: event.timestamp,
          event: {
            type: 'message_stop',
            stop_reason: event.finishReason ?? 'end_turn',
          },
        }),
      );

      this.streamStates.delete(event.streamId);
      return;
    }

    this.emit(encodeStreamLoopEvent({ uuid: randomUUID(), sessionId: this.sessionId, event }));
  }

  onFinish(result: LoopResult): void {
    if (result.authorizationSummary) {
      const at = this.now();
      this.emit(
        encodeStreamLoopEvent({
          uuid: randomUUID(),
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
      uuid: randomUUID(),
      sessionId: this.sessionId,
      loopResult: result,
      at,
      resultText: this.lastTextResult,
    });
    this.emit(resultLine);

    const exitCode = getStreamExitCode(result);
    this.emit(
      encodeStreamEnd({
        uuid: randomUUID(),
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
        uuid: randomUUID(),
        sessionId: this.sessionId,
        at: this.now(),
        message: error.message,
        name: error.name,
        stack: error.stack,
      }),
    );
  }

  private emit(line: StreamJsonEnvelope): void {
    this.write(JSON.stringify(line) + '\n');
  }

  private emitStreamPreludeIfNeeded(streamId: string, at: Date): void {
    const existing = this.streamStates.get(streamId);
    if (existing?.started) return;

    const state: StreamState = existing ?? {
      messageId: streamId,
      started: false,
      contentBlockOpen: false,
    };
    state.started = true;
    state.contentBlockOpen = true;
    this.streamStates.set(streamId, state);

    this.emit(
      encodeStreamEvent({
        uuid: randomUUID(),
        sessionId: this.sessionId,
        at,
        event: {
          type: 'message_start',
          message: {
            id: state.messageId,
            type: 'message',
            role: 'assistant',
            content: [],
          },
        },
      }),
    );

    this.emit(
      encodeStreamEvent({
        uuid: randomUUID(),
        sessionId: this.sessionId,
        at,
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
      }),
    );
  }
}
