import type { LLMMessage, LLMRole, LLMStreamChunk } from '../../types/llm.js';
import { isRecord } from '../../utils/serialize.js';
import { mapAiSdkStreamPartToChunk } from '../stream-utils.js';

import { toOpenAiToolCalls } from './message-mapper.js';

function extractReasoningContent(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  if (typeof result.reasoningText === 'string' && result.reasoningText.length > 0) {
    return result.reasoningText;
  }

  const reasoningParts = Array.isArray(result.reasoning)
    ? result.reasoning
    : Array.isArray(result.content)
      ? (result.content as unknown[]).filter(
          (part): part is Record<string, unknown> => isRecord(part) && part.type === 'reasoning',
        )
      : [];
  const text = reasoningParts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('');

  return text.length > 0 ? text : undefined;
}

export function mapAiSdkGenerateResultToMessage(result: unknown): LLMMessage {
  const reasoningContent = extractReasoningContent(result);
  const r = isRecord(result) ? result : {};

  return {
    role: 'assistant' as LLMRole,
    content: typeof r.text === 'string' ? r.text : '',
    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
    tool_calls: toOpenAiToolCalls(r.toolCalls),
  };
}

export async function* mapAiSdkStreamResultToChunks(
  fullStream: AsyncIterable<unknown>,
): AsyncIterable<LLMStreamChunk> {
  let doneEmitted = false;

  for await (const part of fullStream) {
    if (!part) continue;

    if (part.type === 'error') throw part.error;
    if (part.type === 'abort') throw new Error('Stream aborted');

    const chunk = mapAiSdkStreamPartToChunk(part);
    if (!chunk) continue;

    if (chunk.done) {
      doneEmitted = true;
    }
    yield chunk;
  }

  if (!doneEmitted) {
    yield { role: 'assistant' as LLMRole, done: true, finishReason: 'unknown' };
  }
}
