import type { LLMMessage, LLMRole, LLMStreamChunk } from '../../types/llm.js';
import { mapAiSdkStreamPartToChunk } from '../stream-utils.js';

import { toOpenAiToolCalls } from './message-mapper.js';

export function mapAiSdkGenerateResultToMessage(result: any): LLMMessage {
  return {
    role: 'assistant' as LLMRole,
    content: result?.text || '',
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
