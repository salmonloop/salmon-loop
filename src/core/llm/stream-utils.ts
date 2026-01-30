import type { LLMStreamChunk } from '../types.js';

type AiSdkStreamPart =
  | string
  | {
      type?: string;
      text?: string;
      toolCallId?: string;
      toolName?: string;
      input?: unknown;
    };

export function mapAiSdkStreamPartToChunk(part: AiSdkStreamPart): LLMStreamChunk | null {
  if (!part) return null;

  if (typeof part === 'string') {
    return { role: 'assistant', contentDelta: part };
  }

  if (typeof part !== 'object' || Array.isArray(part)) {
    return null;
  }

  if (part.type === 'text-delta' || part.type === 'reasoning-delta') {
    if (typeof part.text === 'string' && part.text) {
      return { role: 'assistant', contentDelta: part.text };
    }
    return null;
  }

  if (part.type === 'tool-call') {
    const toolCallId = part.toolCallId || 'unknown';
    const toolName = part.toolName || 'unknown';

    let argsText = '{}';
    try {
      argsText = JSON.stringify(part.input ?? {});
    } catch {
      argsText = '{}';
    }

    return {
      role: 'assistant',
      tool_calls: [
        {
          id: toolCallId,
          type: 'function',
          function: {
            name: toolName,
            arguments: argsText,
          },
        },
      ],
    };
  }

  if (part.type === 'finish') {
    return { role: 'assistant', done: true };
  }

  return null;
}
