import { randomUUID } from 'crypto';

import type { LoopEvent, LoopResult } from '../../core/types/index.js';
import {
  encodeAnthropicEnd,
  encodeAnthropicError,
  encodeAnthropicResult,
  encodeAnthropicStart,
  encodeAnthropicStreamEvent,
  type AnthropicStreamLine,
} from '../headless/anthropic-stream-protocol.js';

import type { SalmonReporter } from './base.js';

export interface AnthropicStreamReporterOptions {
  mode?: 'run' | 'chat';
  repoPath?: string;
  sessionId?: string;
  write?: (chunk: string) => boolean;
}

type StreamState = {
  messageId: string;
  started: boolean;
  contentBlockOpen: boolean;
};

export class AnthropicStreamReporter implements SalmonReporter {
  private readonly mode: 'run' | 'chat';
  private readonly repoPath?: string;
  private readonly sessionId: string;
  private readonly write: (chunk: string) => boolean;

  private lastTextResult: string | undefined;
  private readonly streamStates = new Map<string, StreamState>();

  constructor(options: AnthropicStreamReporterOptions = {}) {
    this.mode = options.mode ?? 'run';
    this.repoPath = options.repoPath;
    this.sessionId = options.sessionId ?? randomUUID();
    this.write = options.write ?? ((chunk) => process.stdout.write(chunk));
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

    if (event.type === 'llm.stream.delta') {
      this.emitStreamPreludeIfNeeded(event.streamId);
      this.emit(
        encodeAnthropicStreamEvent({
          sessionId: this.sessionId,
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
      this.emitStreamPreludeIfNeeded(event.streamId);

      const state = this.streamStates.get(event.streamId);
      if (state?.contentBlockOpen) {
        this.emit(
          encodeAnthropicStreamEvent({
            sessionId: this.sessionId,
            event: { type: 'content_block_stop', index: 0 },
          }),
        );
        state.contentBlockOpen = false;
      }

      this.emit(
        encodeAnthropicStreamEvent({
          sessionId: this.sessionId,
          event: {
            type: 'message_stop',
            stop_reason: event.finishReason ?? 'end_turn',
          },
        }),
      );

      this.streamStates.delete(event.streamId);
      return;
    }

    if (event.type === 'tool.call.start') {
      this.emitToolUse(event);
      return;
    }

    if (event.type === 'tool.call.end') {
      this.emitToolResult(event);
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
    this.write(JSON.stringify(line) + '\n');
  }

  private emitStreamPreludeIfNeeded(streamId: string): void {
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
      encodeAnthropicStreamEvent({
        sessionId: this.sessionId,
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
      encodeAnthropicStreamEvent({
        sessionId: this.sessionId,
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
      }),
    );
  }

  private emitToolUse(event: Extract<LoopEvent, { type: 'tool.call.start' }>): void {
    this.emit(
      encodeAnthropicStreamEvent({
        sessionId: this.sessionId,
        parentToolUseId: event.callId,
        event: {
          type: 'message_start',
          message: {
            id: `tool_use:${event.callId}`,
            type: 'message',
            role: 'assistant',
            content: [],
          },
        },
      }),
    );
    this.emit(
      encodeAnthropicStreamEvent({
        sessionId: this.sessionId,
        parentToolUseId: event.callId,
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: event.callId,
            name: event.toolName,
            input: {},
          },
        },
      }),
    );
    this.emit(
      encodeAnthropicStreamEvent({
        sessionId: this.sessionId,
        parentToolUseId: event.callId,
        event: { type: 'content_block_stop', index: 0 },
      }),
    );
    this.emit(
      encodeAnthropicStreamEvent({
        sessionId: this.sessionId,
        parentToolUseId: event.callId,
        event: { type: 'message_stop', stop_reason: 'tool_use' },
      }),
    );
  }

  private emitToolResult(event: Extract<LoopEvent, { type: 'tool.call.end' }>): void {
    const isError = event.status !== 'ok';
    const summaryParts: string[] = [];
    summaryParts.push(`tool=${event.toolName}`);
    summaryParts.push(`status=${event.status}`);
    if (typeof event.durationMs === 'number') {
      summaryParts.push(`duration_ms=${event.durationMs}`);
    }
    if (event.errorCode) summaryParts.push(`error_code=${event.errorCode}`);

    this.emit(
      encodeAnthropicStreamEvent({
        sessionId: this.sessionId,
        parentToolUseId: event.callId,
        event: {
          type: 'message_start',
          message: {
            id: `tool_result:${event.callId}`,
            type: 'message',
            role: 'user',
            content: [],
          },
        },
      }),
    );
    this.emit(
      encodeAnthropicStreamEvent({
        sessionId: this.sessionId,
        parentToolUseId: event.callId,
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_result',
            tool_use_id: event.callId,
            is_error: isError,
            content: summaryParts.join(' '),
          },
        },
      }),
    );
    this.emit(
      encodeAnthropicStreamEvent({
        sessionId: this.sessionId,
        parentToolUseId: event.callId,
        event: { type: 'content_block_stop', index: 0 },
      }),
    );
    this.emit(
      encodeAnthropicStreamEvent({
        sessionId: this.sessionId,
        parentToolUseId: event.callId,
        event: { type: 'message_stop', stop_reason: 'end_turn' },
      }),
    );
  }
}
