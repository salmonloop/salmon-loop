import { beforeEach, describe, expect, it, mock } from 'bun:test';

const generateTextMock = mock(async () => ({
  text: JSON.stringify({
    goal: 'Goal',
    files: ['src/index.ts'],
    changes: ['Change'],
    verify: 'bun test',
  }),
  usage: { promptTokens: 1, completionTokens: 2 },
}));

mock.module('ai', () => ({
  generateText: generateTextMock,
  streamText: mock(async () => ({
    fullStream: (async function* () {
      yield { type: 'finish', finishReason: 'stop' };
    })(),
  })),
}));

mock.module('@ai-sdk/openai', () => ({
  createOpenAI: () => ({
    chat: (modelId: string) => ({ provider: 'openai', modelId }),
  }),
}));

mock.module('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => ({
    chatModel: (modelId: string) => ({ provider: 'openai-compatible', modelId }),
  }),
}));

mock.module('../../src/core/prompts/runtime.js', () => ({
  getPlanPrompt: mock(async () => 'PLAN PROMPT'),
  getPatchPrompt: mock(async () => 'PATCH PROMPT'),
}));

import { AiSdkLLM } from '../../src/core/llm/ai-sdk.js';
import type { Context } from '../../src/core/types/context.js';
import type { ChatOptions } from '../../src/core/types/llm.js';
import type { Plan } from '../../src/core/types/planning.js';

const LARGE_CONTEXT = 'export const value = 1;\n'.repeat(400);

interface GenerateTextCallParams {
  providerOptions?: {
    openaiCompatible?: {
      user?: string;
    };
  };
}

function createTestContext(contextHash: string): Context {
  return {
    repoPath: '/repo',
    primaryFile: 'src/index.ts',
    primaryText: LARGE_CONTEXT,
    contextHash,
    rgSnippets: [],
  };
}

function getFirstGenerateParams(): GenerateTextCallParams | undefined {
  const firstCall = generateTextMock.mock.calls[0] as unknown[] | undefined;
  const [params] = firstCall ?? [];
  return params as GenerateTextCallParams | undefined;
}

describe('AiSdkLLM cache contract', () => {
  beforeEach(() => {
    mock.clearAllMocks();
  });

  it('propagates request-envelope cache hint into final OpenAI-compatible request for createPlan', async () => {
    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai-compatible',
      providerName: 'openai-compatible',
      modelId: 'test-model',
      baseUrl: 'https://example.invalid/v1',
    });

    await llm.createPlan(createTestContext('ctx-plan-123'), 'Do the plan');

    const params = getFirstGenerateParams();
    expect(params?.providerOptions?.openaiCompatible?.user).toContain('cache:');
    expect(params?.providerOptions?.openaiCompatible?.user).toContain('"namespace":"plan"');
    expect(params?.providerOptions?.openaiCompatible?.user).toContain('"ctx-plan-123"');
  });

  it('propagates request-envelope cache hint into final OpenAI-compatible request for createPatch', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'diff --git a/src/index.ts b/src/index.ts\n--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,1 +1,1 @@\n-export const value = 1;\n+export const value = 2;',
      usage: { promptTokens: 1, completionTokens: 2 },
    });

    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai-compatible',
      providerName: 'openai-compatible',
      modelId: 'test-model',
      baseUrl: 'https://example.invalid/v1',
    });

    const plan: Plan = {
      goal: 'Goal',
      files: ['src/index.ts'],
      changes: ['Change'],
      verify: 'bun test',
    };

    await llm.createPatch(createTestContext('ctx-patch-456'), plan);

    const params = getFirstGenerateParams();
    expect(params?.providerOptions?.openaiCompatible?.user).toContain('cache:');
    expect(params?.providerOptions?.openaiCompatible?.user).toContain('"namespace":"patch"');
    expect(params?.providerOptions?.openaiCompatible?.user).toContain('"ctx-patch-456"');
  });

  it('does not override explicit providerOptions.user when cache hints are also present', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'ok',
      usage: { promptTokens: 1, completionTokens: 2 },
    });

    const llm = new AiSdkLLM({
      clientPackage: '@ai-sdk/openai-compatible',
      providerName: 'openai-compatible',
      modelId: 'test-model',
      baseUrl: 'https://example.invalid/v1',
    });

    const options: ChatOptions = {
      providerHints: {
        openAICacheHint: 'cache:{"namespace":"manual","components":["ctx-manual-1"]}',
      },
      providerOptions: {
        openaiCompatible: {
          user: 'caller-user-hint',
        },
      },
    };

    await llm.chat(
      [
        { role: 'system', content: 'S'.repeat(5000) },
        { role: 'user', content: 'hello' },
      ],
      options,
    );

    const params = getFirstGenerateParams();
    expect(params?.providerOptions?.openaiCompatible?.user).toBe('caller-user-hint');
  });
});
