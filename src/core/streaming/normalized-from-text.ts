import { normalizeStopReason, type NormalizedStreamEvent } from './normalized-events.js';

export function createAssistantTextMessageEvents(params: {
  messageId: string;
  text: string;
  timestamp: Date;
  finishReason?: string;
}): NormalizedStreamEvent[] {
  const blockId = `${params.messageId}:text:0`;
  const out: NormalizedStreamEvent[] = [
    {
      type: 'normalized.message_start',
      messageId: params.messageId,
      role: 'assistant',
      source: 'llm',
      timestamp: params.timestamp,
    },
    {
      type: 'normalized.content_block_start',
      messageId: params.messageId,
      blockId,
      blockType: 'text',
      index: 0,
      timestamp: params.timestamp,
    },
  ];

  if (params.text) {
    out.push({
      type: 'normalized.content_block_delta',
      messageId: params.messageId,
      blockId,
      index: 0,
      deltaType: 'text',
      text: params.text,
      timestamp: params.timestamp,
    });
  }

  out.push(
    {
      type: 'normalized.content_block_end',
      messageId: params.messageId,
      blockId,
      index: 0,
      timestamp: params.timestamp,
    },
    {
      type: 'normalized.message_end',
      messageId: params.messageId,
      stopReason: normalizeStopReason(params.finishReason),
      finishReason: params.finishReason,
      timestamp: params.timestamp,
    },
  );

  return out;
}
