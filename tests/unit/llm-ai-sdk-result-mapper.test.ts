import { describe, expect, it } from 'bun:test';

import {
  mapAiSdkGenerateResultToMessage,
  mapAiSdkStreamResultToChunks,
} from '../../src/core/llm/ai-sdk/result-mapper.js';

describe('ai-sdk result mapper', () => {
  it('maps generateText result to assistant message with tool calls', () => {
    const mapped = mapAiSdkGenerateResultToMessage({
      text: 'hello',
      toolCalls: [
        {
          toolCallId: 'call_1',
          toolName: 'fs.read',
          input: { file: 'README.md' },
        },
      ],
    });

    expect(mapped.role).toBe('assistant');
    expect(mapped.content).toBe('hello');
    expect(mapped.tool_calls?.[0]?.function?.name).toBe('fs.read');
  });

  it('yields stream chunks and preserves finish chunk', async () => {
    async function* fullStream() {
      yield { type: 'text-delta', text: 'Hello' };
      yield {
        type: 'finish',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 2 },
      };
    }

    const chunks: any[] = [];
    for await (const chunk of mapAiSdkStreamResultToChunks(fullStream())) {
      chunks.push(chunk);
    }

    expect(chunks[0]?.contentDelta).toBe('Hello');
    expect(chunks[chunks.length - 1]?.done).toBe(true);
    expect(chunks[chunks.length - 1]?.finishReason).toBe('stop');
  });

  it('emits synthesized done chunk when finish is missing', async () => {
    async function* fullStream() {
      yield { type: 'text-delta', text: 'Hello' };
    }

    const chunks: any[] = [];
    for await (const chunk of mapAiSdkStreamResultToChunks(fullStream())) {
      chunks.push(chunk);
    }

    expect(chunks[chunks.length - 1]).toMatchObject({
      role: 'assistant',
      done: true,
      finishReason: 'unknown',
    });
  });

  it('throws on stream error and abort parts', async () => {
    async function* errorStream() {
      yield { type: 'error', error: new Error('stream-fail') };
    }

    await expect(
      (async () => {
        for await (const _chunk of mapAiSdkStreamResultToChunks(errorStream())) {
          // no-op
        }
      })(),
    ).rejects.toThrow('stream-fail');

    async function* abortStream() {
      yield { type: 'abort' };
    }

    await expect(
      (async () => {
        for await (const _chunk of mapAiSdkStreamResultToChunks(abortStream())) {
          // no-op
        }
      })(),
    ).rejects.toThrow('Stream aborted');
  });
});
