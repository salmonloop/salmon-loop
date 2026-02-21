import { getExitCode } from '../runtime/exit-codes.js';
import type { LoopEvent, LoopResult } from '../types/index.js';

import type {
  CanonicalResponseFunctionCallItem,
  CanonicalResponseOutputItemAddedEvent,
  CanonicalResponseOutputItemDoneEvent,
  CanonicalResponsesEvent,
} from './canonical/responses-events.js';
import { normalizeStopReason, type NormalizedStreamEvent } from './normalized-events.js';

type TextStreamState = {
  messageId: string;
  textBlockId: string;
  started: boolean;
  textBlockOpen: boolean;
};

type ToolCallState = {
  requestStarted: boolean;
  requestEnded: boolean;
  executionStarted: boolean;
};

export interface StreamAssemblerOptions {
  clock?: () => Date;
}

export class StreamAssembler {
  private readonly clock: () => Date;
  private readonly streams = new Map<string, TextStreamState>();
  private readonly canonicalTextStreams = new Set<string>();
  private readonly canonicalClosedTextStreams = new Set<string>();
  private readonly toolCallStates = new Map<string, ToolCallState>();

  constructor(options: StreamAssemblerOptions = {}) {
    this.clock = options.clock ?? (() => new Date());
  }

  push(event: LoopEvent): NormalizedStreamEvent[] {
    if (event.type === 'llm.responses.event') {
      return this.handleResponsesLoopEvent(event);
    }

    if (event.type === 'llm.stream.delta' && this.canonicalTextStreams.has(event.streamId)) {
      return [];
    }

    if (event.type === 'llm.stream.delta') {
      return this.handleTextDelta(event.streamId, event.timestamp, event.content);
    }

    if (event.type === 'llm.stream.end') {
      if (this.canonicalClosedTextStreams.has(event.streamId)) {
        this.canonicalClosedTextStreams.delete(event.streamId);
        this.canonicalTextStreams.delete(event.streamId);
        this.streams.delete(event.streamId);
        return [];
      }
      this.canonicalTextStreams.delete(event.streamId);
      return this.handleTextEnd(event.streamId, event.timestamp, event.finishReason);
    }

    if (event.type === 'tool.call.start') {
      const out: NormalizedStreamEvent[] = [];
      const st = this.getToolCallState(event.callId);

      if (!st.requestStarted) {
        st.requestStarted = true;
        out.push({
          type: 'normalized.tool_request_start',
          callId: event.callId,
          toolName: event.toolName,
          phase: event.phase,
          round: event.round,
          timestamp: event.timestamp,
        });
      }

      if (!st.requestEnded) {
        st.requestEnded = true;
        out.push({
          type: 'normalized.tool_request_end',
          callId: event.callId,
          toolName: event.toolName,
          phase: event.phase,
          round: event.round,
          timestamp: event.timestamp,
        });
      }

      if (st.executionStarted) return out;
      st.executionStarted = true;

      out.push({
        type: 'normalized.tool_call_start',
        callId: event.callId,
        toolName: event.toolName,
        phase: event.phase,
        round: event.round,
        ...(event.input === undefined ? {} : { input: event.input }),
        timestamp: event.timestamp,
      });

      return out;
    }

    if (event.type === 'tool.call.end') {
      const out: NormalizedStreamEvent[] = [];
      const st = this.getToolCallState(event.callId);

      if (!st.requestStarted) {
        st.requestStarted = true;
        out.push({
          type: 'normalized.tool_request_start',
          callId: event.callId,
          toolName: event.toolName,
          phase: event.phase,
          round: event.round,
          timestamp: event.timestamp,
        });
      }

      if (!st.requestEnded) {
        st.requestEnded = true;
        out.push({
          type: 'normalized.tool_request_end',
          callId: event.callId,
          toolName: event.toolName,
          phase: event.phase,
          round: event.round,
          timestamp: event.timestamp,
        });
      }

      out.push({
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
      });

      this.toolCallStates.delete(event.callId);
      return out;
    }

    return [];
  }

  finish(result: LoopResult): NormalizedStreamEvent[] {
    this.streams.clear();
    this.canonicalTextStreams.clear();
    this.canonicalClosedTextStreams.clear();
    this.toolCallStates.clear();
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

  private handleResponsesLoopEvent(
    event: Extract<LoopEvent, { type: 'llm.responses.event' }>,
  ): NormalizedStreamEvent[] {
    if (isOutputTextDeltaEvent(event.event)) {
      this.canonicalTextStreams.add(event.streamId);
      return this.handleTextDelta(event.streamId, event.timestamp, event.event.delta);
    }

    if (isOutputTextDoneEvent(event.event)) {
      if (this.canonicalClosedTextStreams.has(event.streamId)) return [];
      this.canonicalClosedTextStreams.add(event.streamId);
      this.canonicalTextStreams.delete(event.streamId);
      return this.handleTextEnd(event.streamId, event.timestamp, undefined);
    }

    if (
      isOutputItemAddedMessageEvent(event.event) ||
      isContentPartAddedOutputTextEvent(event.event)
    ) {
      return this.ensureTextStreamStarted(event.streamId, event.timestamp);
    }

    if (
      isOutputItemDoneMessageEvent(event.event) ||
      isContentPartDoneOutputTextEvent(event.event)
    ) {
      if (this.canonicalClosedTextStreams.has(event.streamId)) return [];
      this.canonicalClosedTextStreams.add(event.streamId);
      this.canonicalTextStreams.delete(event.streamId);
      return this.handleTextEnd(event.streamId, event.timestamp, undefined);
    }

    if (isOutputItemAddedFunctionCallEvent(event.event)) {
      if (!event.phase || typeof event.round !== 'number') return [];

      const callId = event.event.item.call_id;
      const toolName = event.event.item.name;
      const st = this.getToolCallState(callId);
      if (st.requestStarted) return [];
      st.requestStarted = true;

      return [
        {
          type: 'normalized.tool_request_start',
          callId,
          toolName,
          phase: event.phase,
          round: event.round,
          timestamp: event.timestamp,
        },
      ];
    }

    if (isOutputItemDoneFunctionCallEvent(event.event)) {
      if (!event.phase || typeof event.round !== 'number') return [];
      const callId = event.event.item.call_id;
      const st = this.getToolCallState(callId);
      if (st.requestEnded) return [];
      st.requestEnded = true;
      return [
        {
          type: 'normalized.tool_request_end',
          callId,
          toolName: event.event.item.name,
          phase: event.phase,
          round: event.round,
          timestamp: event.timestamp,
        },
      ];
    }

    return [];
  }

  private getToolCallState(callId: string): ToolCallState {
    const existing = this.toolCallStates.get(callId);
    if (existing) return existing;
    const created: ToolCallState = {
      requestStarted: false,
      requestEnded: false,
      executionStarted: false,
    };
    this.toolCallStates.set(callId, created);
    return created;
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

function isOutputItemAddedFunctionCallEvent(
  event: CanonicalResponsesEvent,
): event is CanonicalResponseOutputItemAddedEvent & { item: CanonicalResponseFunctionCallItem } {
  if (event.type !== 'response.output_item.added') return false;
  const candidate = event as { item?: unknown };
  if (!candidate.item || typeof candidate.item !== 'object') return false;
  const item = candidate.item as { type?: unknown; call_id?: unknown; name?: unknown };
  return (
    item.type === 'function_call' &&
    typeof item.call_id === 'string' &&
    typeof item.name === 'string'
  );
}

function isOutputItemDoneFunctionCallEvent(
  event: CanonicalResponsesEvent,
): event is CanonicalResponseOutputItemDoneEvent & { item: CanonicalResponseFunctionCallItem } {
  if (event.type !== 'response.output_item.done') return false;
  const candidate = event as { item?: unknown };
  if (!candidate.item || typeof candidate.item !== 'object') return false;
  const item = candidate.item as { type?: unknown; call_id?: unknown; name?: unknown };
  return (
    item.type === 'function_call' &&
    typeof item.call_id === 'string' &&
    typeof item.name === 'string'
  );
}

function isOutputItemAddedMessageEvent(
  event: CanonicalResponsesEvent,
): event is Extract<CanonicalResponsesEvent, { type: 'response.output_item.added' }> {
  if (event.type !== 'response.output_item.added') return false;
  const candidate = event as { item?: unknown };
  if (!candidate.item || typeof candidate.item !== 'object') return false;
  const item = candidate.item as { type?: unknown; role?: unknown };
  return item.type === 'message' && typeof item.role === 'string';
}

function isOutputItemDoneMessageEvent(
  event: CanonicalResponsesEvent,
): event is Extract<CanonicalResponsesEvent, { type: 'response.output_item.done' }> {
  if (event.type !== 'response.output_item.done') return false;
  const candidate = event as { item?: unknown };
  if (!candidate.item || typeof candidate.item !== 'object') return false;
  const item = candidate.item as { type?: unknown; role?: unknown };
  return item.type === 'message' && typeof item.role === 'string';
}

function isContentPartAddedOutputTextEvent(
  event: CanonicalResponsesEvent,
): event is Extract<CanonicalResponsesEvent, { type: 'response.content_part.added' }> {
  if (event.type !== 'response.content_part.added') return false;
  const candidate = event as { part?: unknown };
  if (!candidate.part || typeof candidate.part !== 'object') return false;
  const part = candidate.part as { type?: unknown };
  return part.type === 'output_text';
}

function isContentPartDoneOutputTextEvent(
  event: CanonicalResponsesEvent,
): event is Extract<CanonicalResponsesEvent, { type: 'response.content_part.done' }> {
  if (event.type !== 'response.content_part.done') return false;
  const candidate = event as { part?: unknown };
  if (!candidate.part || typeof candidate.part !== 'object') return false;
  const part = candidate.part as { type?: unknown };
  return part.type === 'output_text';
}
