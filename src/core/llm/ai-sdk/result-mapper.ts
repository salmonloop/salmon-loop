import type { LLMMessage, LLMRole, LLMStreamChunk } from '../../types/llm.js';
import { mapAiSdkStreamPartToChunk } from '../stream-utils.js';

import { toOpenAiToolCalls } from './message-mapper.js';

function extractReasoningContent(result: any): string | undefined {
  if (typeof result?.reasoningText === 'string' && result.reasoningText.length > 0) {
    return result.reasoningText;
  }

  const reasoningParts = Array.isArray(result?.reasoning)
    ? result.reasoning
    : Array.isArray(result?.content)
      ? result.content.filter((part: any) => part?.type === 'reasoning')
      : [];
  const text = reasoningParts
    .map((part: any) => (typeof part?.text === 'string' ? part.text : ''))
    .join('');

  return text.length > 0 ? text : undefined;
}

export function mapAiSdkGenerateResultToMessage(result: any): LLMMessage {
  const reasoningContent = extractReasoningContent(result);

  return {
    role: 'assistant' as LLMRole,
    content: result?.text || '',
    ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
    tool_calls: toOpenAiToolCalls(result?.toolCalls),
  };
}

export async function* mapAiSdkStreamResultToChunks(
  fullStream: AsyncIterable<any>,
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
