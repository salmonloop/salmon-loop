import type { LLMStreamChunk } from '../types/index.js';

// Type definition for AI SDK stream parts (for documentation purposes)
type _AiSdkStreamPart =
  | string
  | {
      type: 'text-delta' | 'reasoning-delta';
      text: string;
    }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: unknown;
    }
  | {
      type: 'error';
      error: unknown;
    }
  | {
      type: 'abort';
      reason?: string;
    }
  | {
      type: 'finish';
      finishReason: string;
      usage?: {
        promptTokens: number;
        completionTokens: number;
      };
    };

export function mapAiSdkStreamPartToChunk(part: any): LLMStreamChunk | null {
  if (!part) return null;

  if (typeof part === 'string') {
    return { role: 'assistant', contentDelta: part };
  }

  if (typeof part !== 'object' || Array.isArray(part)) {
    return null;
  }

  switch (part.type) {
    case 'text-delta':
    case 'reasoning-delta':
      if (typeof part.text === 'string' && part.text) {
        return { role: 'assistant', contentDelta: part.text };
      }
      return null;

    case 'tool-call':
      return {
        role: 'assistant',
        tool_calls: [
          {
            id: part.toolCallId || 'unknown',
            type: 'function',
            function: {
              name: part.toolName || 'unknown',
              arguments: JSON.stringify(part.input ?? {}),
            },
          },
        ],
      };

    case 'finish':
      return {
        role: 'assistant',
        done: true,
        finishReason: part.finishReason,
        usage:
          part.usage &&
          typeof part.usage === 'object' &&
          typeof part.usage.promptTokens === 'number' &&
          typeof part.usage.completionTokens === 'number'
            ? {
                promptTokens: part.usage.promptTokens,
                completionTokens: part.usage.completionTokens,
              }
            : undefined,
      };

    case 'error':
      // We don't return a chunk for errors here; we want the generator to throw
      return null;

    case 'abort':
      return {
        role: 'assistant',
        done: true,
        finishReason: 'abort',
      };

    default:
      return null;
  }
}
