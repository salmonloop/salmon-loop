import type { NormalizedStreamEvent } from '../../core/facades/cli-headless.js';

import {
  encodeStreamEvent,
  encodeStreamFailure,
  type StreamJsonEnvelope,
} from './stream-json-protocol.js';

function asToolInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function encodeNormalizedToNativeStreamLines(params: {
  sessionId: string;
  uuid: () => string;
  event: NormalizedStreamEvent;
  includeToolInput?: boolean;
}): StreamJsonEnvelope[] {
  const at = params.event.timestamp;

  if (params.event.type === 'normalized.message_start') {
    return [
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        event: {
          type: 'message_start',
          message: {
            id: params.event.messageId,
            type: 'message',
            role: params.event.role,
            content: [],
          },
        },
      }),
    ];
  }

  if (params.event.type === 'normalized.content_block_start') {
    if (params.event.blockType === 'text') {
      return [
        encodeStreamEvent({
          uuid: params.uuid(),
          sessionId: params.sessionId,
          at,
          event: {
            type: 'content_block_start',
            index: params.event.index,
            content_block: { type: 'text', text: '' },
          },
        }),
      ];
    }

    // Tool blocks are derived from normalized.tool_request_* and normalized.tool_call_end events.
    return [];
  }

  if (params.event.type === 'normalized.content_block_delta') {
    return [
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        event: {
          type: 'content_block_delta',
          index: params.event.index,
          delta: { type: 'text_delta', text: params.event.text },
        },
      }),
    ];
  }

  if (params.event.type === 'normalized.content_block_end') {
    return [
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        event: { type: 'content_block_stop', index: params.event.index },
      }),
    ];
  }

  if (params.event.type === 'normalized.message_end') {
    return [
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        event: { type: 'message_stop', stop_reason: params.event.finishReason ?? 'end_turn' },
      }),
    ];
  }

  if (params.event.type === 'normalized.tool_request_start') {
    const parentToolUseId = params.event.callId;
    const phase = params.event.phase;
    const round = params.event.round;
    const input = params.includeToolInput ? asToolInput(params.event.input) : {};

    return [
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        parentToolUseId,
        event: {
          type: 'message_start',
          message: {
            id: `tool_use:${parentToolUseId}`,
            type: 'message',
            role: 'assistant',
            content: [],
          },
        },
      }),
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        parentToolUseId,
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: parentToolUseId,
            name: params.event.toolName,
            input,
            meta: { phase, round },
          },
        },
      }),
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        parentToolUseId,
        event: { type: 'content_block_stop', index: 0 },
      }),
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        parentToolUseId,
        event: { type: 'message_stop', stop_reason: 'tool_use' },
      }),
    ];
  }

  if (params.event.type === 'normalized.tool_call_end') {
    const parentToolUseId = params.event.callId;
    const phase = params.event.phase;
    const round = params.event.round;
    const isError = params.event.status !== 'ok';

    const summaryParts: string[] = [];
    summaryParts.push(`tool=${params.event.toolName}`);
    summaryParts.push(`status=${params.event.status}`);
    if (typeof params.event.durationMs === 'number') {
      summaryParts.push(`duration_ms=${params.event.durationMs}`);
    }
    if (params.event.errorCode) summaryParts.push(`error_code=${params.event.errorCode}`);
    let content = summaryParts.join(' ');
    if (params.event.outputSummary) content += `\noutput_summary=${params.event.outputSummary}`;

    return [
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        parentToolUseId,
        event: {
          type: 'message_start',
          message: {
            id: `tool_result:${parentToolUseId}`,
            type: 'message',
            role: 'user',
            content: [],
          },
        },
      }),
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        parentToolUseId,
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_result',
            tool_use_id: parentToolUseId,
            is_error: isError,
            content,
            meta: { phase, round },
          },
        },
      }),
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        parentToolUseId,
        event: { type: 'content_block_stop', index: 0 },
      }),
      encodeStreamEvent({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        parentToolUseId,
        event: { type: 'message_stop', stop_reason: 'end_turn' },
      }),
    ];
  }

  if (params.event.type === 'normalized.error') {
    return [
      encodeStreamFailure({
        uuid: params.uuid(),
        sessionId: params.sessionId,
        at,
        message: params.event.message,
        name: params.event.code,
      }),
    ];
  }

  return [];
}
