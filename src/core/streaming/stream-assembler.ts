import { getExitCode } from '../runtime/exit-codes.js';
import type { LoopEvent, LoopResult } from '../types/index.js';

import type { CanonicalResponsesEvent } from './canonical/responses-events.js';
import { normalizeStopReason, type NormalizedStreamEvent } from './normalized-events.js';

type TextStreamState = {
  messageId: string;
  textBlockId: string;
  started: boolean;
  textBlockOpen: boolean;
};

export interface StreamAssemblerOptions {
  clock?: () => Date;
}

export class StreamAssembler {
  private readonly clock: () => Date;
  private readonly streams = new Map<string, TextStreamState>();

  constructor(options: StreamAssemblerOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  push(event: LoopEvent): NormalizedStreamEvent[] {
    if (event.type === 'llm.stream.delta') {
      return this.handleTextDelta(event.streamId, event.timestamp, event.content);
    }

    if (event.type === 'llm.stream.end') {
      return this.handleTextEnd(event.streamId, event.timestamp, event.finishReason);
    }

    if (event.type === 'llm.responses.event') {
      return this.handleResponsesEvent(event.streamId, event.timestamp, event.event);
    }

    if (event.type === 'tool.call.start') {
      return [
        {
          type: 'normalized.tool_call_start',
          callId: event.callId,
          toolName: event.toolName,
          phase: event.phase,
          round: event.round,
          input: event.input,
          timestamp: event.timestamp,
        },
      ];
    }

    if (event.type === 'tool.call.end') {
      return [
        {
          type: 'normalized.tool_call_end',
          callId: event.callId,
          toolName: event.toolName,
          phase: event.phase,
          round: event.round,
          status: event.status,
          durationMs: event.durationMs,
          errorCode: event.errorCode,
          outputSummary: event.outputSummary,
          timestamp: event.timestamp,
        },
      ];
    }

    return [];
  }

  finish(result: LoopResult): NormalizedStreamEvent[] {
    return [
      {
        type: 'normalized.run_end',
        success: Boolean(result.success),
        exitCode: getExitCode(result),
        reason: result.reason,
        reasonCode: result.reasonCode,
        timestamp: this.clock(),
      },
    ];
  }

  private ensureTextStreamStarted(streamId: string, at: Date): NormalizedStreamEvent[] {
    const existing = this.streams.get(streamId);
    if (existing?.started && existing.textBlockOpen) return [];

    const state: TextStreamState = existing ?? {
      messageId: streamId,
      textBlockId: `${streamId}:text:0`,
      started: false,
      textBlockOpen: false,
    };
    state.started = true;
    state.textBlockOpen = true;
    this.streams.set(streamId, state);

    return [
      {
        type: 'normalized.message_start',
        messageId: state.messageId,
        role: 'assistant',
        source: 'llm',
        timestamp: at,
      },
      {
        type: 'normalized.content_block_start',
        messageId: state.messageId,
        blockId: state.textBlockId,
        blockType: 'text',
        index: 0,
        timestamp: at,
      },
    ];
  }

  private handleTextDelta(streamId: string, at: Date, text: string): NormalizedStreamEvent[] {
    const prelude = this.ensureTextStreamStarted(streamId, at);
    const state = this.streams.get(streamId);
    if (!state) return prelude;

    return [
      ...prelude,
      {
        type: 'normalized.content_block_delta',
        messageId: state.messageId,
        blockId: state.textBlockId,
        index: 0,
        deltaType: 'text',
        text,
        timestamp: at,
      },
    ];
  }

  private handleTextEnd(
    streamId: string,
    at: Date,
    finishReason?: string,
  ): NormalizedStreamEvent[] {
    const prelude = this.ensureTextStreamStarted(streamId, at);
    const state = this.streams.get(streamId);
    const out: NormalizedStreamEvent[] = [...prelude];

    if (state?.textBlockOpen) {
      out.push({
        type: 'normalized.content_block_end',
        messageId: state.messageId,
        blockId: state.textBlockId,
        index: 0,
        timestamp: at,
      });
    }

    out.push({
      type: 'normalized.message_end',
      messageId: state?.messageId ?? streamId,
      stopReason: normalizeStopReason(finishReason),
      finishReason,
      timestamp: at,
    });

    this.streams.delete(streamId);
    return out;
  }

  private handleResponsesEvent(
    streamId: string,
    at: Date,
    event: CanonicalResponsesEvent,
  ): NormalizedStreamEvent[] {
    if (isOutputTextDeltaEvent(event)) {
      return this.handleTextDelta(streamId, at, event.delta);
    }

    if (isOutputTextDoneEvent(event)) {
      return this.handleTextEnd(streamId, at, undefined);
    }

    return [];
  }
}

function isOutputTextDeltaEvent(
  event: CanonicalResponsesEvent,
): event is Extract<CanonicalResponsesEvent, { type: 'response.output_text.delta' }> {
  return (
    event.type === 'response.output_text.delta' &&
    typeof (event as { delta?: unknown }).delta === 'string'
  );
}

function isOutputTextDoneEvent(
  event: CanonicalResponsesEvent,
): event is Extract<CanonicalResponsesEvent, { type: 'response.output_text.done' }> {
  return event.type === 'response.output_text.done';
}
