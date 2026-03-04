import type { NormalizedStreamEvent } from '../../core/facades/cli-headless.js';

import {
  encodeAnthropicStreamEvent,
  type AnthropicStreamLine,
} from './anthropic-stream-protocol.js';

export function encodeNormalizedToAnthropicStreamLines(params: {
  sessionId: string;
  event: NormalizedStreamEvent;
}): AnthropicStreamLine[] {
  if (params.event.type === 'normalized.message_start') {
    return [
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
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
        encodeAnthropicStreamEvent({
          sessionId: params.sessionId,
          event: {
            type: 'content_block_start',
            index: params.event.index,
            content_block: { type: 'text', text: '' },
          },
        }),
      ];
    }
    return [];
  }

  if (params.event.type === 'normalized.content_block_delta') {
    return [
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
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
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
        event: { type: 'content_block_stop', index: params.event.index },
      }),
    ];
  }

  if (params.event.type === 'normalized.message_end') {
    return [
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
        event: {
          type: 'message_stop',
          stop_reason: params.event.finishReason ?? 'end_turn',
        },
      }),
    ];
  }

  if (params.event.type === 'normalized.tool_request_start') {
    const parentToolUseId = params.event.callId;
    const input: Record<string, unknown> = {};

    return [
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
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
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
        parentToolUseId,
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_use',
            id: parentToolUseId,
            name: params.event.toolName,
            input,
          },
        },
      }),
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
        parentToolUseId,
        event: { type: 'content_block_stop', index: 0 },
      }),
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
        parentToolUseId,
        event: { type: 'message_stop', stop_reason: 'tool_use' },
      }),
    ];
  }

  if (params.event.type === 'normalized.tool_call_end') {
    const parentToolUseId = params.event.callId;
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
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
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
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
        parentToolUseId,
        event: {
          type: 'content_block_start',
          index: 0,
          content_block: {
            type: 'tool_result',
            tool_use_id: parentToolUseId,
            is_error: isError,
            content,
          },
        },
      }),
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
        parentToolUseId,
        event: { type: 'content_block_stop', index: 0 },
      }),
      encodeAnthropicStreamEvent({
        sessionId: params.sessionId,
        parentToolUseId,
        event: { type: 'message_stop', stop_reason: 'end_turn' },
      }),
    ];
  }

  return [];
}
