import { beforeEach, describe, expect, it } from 'bun:test';

const hoisted = (() => ({
  createRuntimeLlm: mock(),
  logger: {
    warn: mock(),
  },
  text: {
    cli: {
      apiKeyMissing: 'API key missing',
      providerNotSupported: (_provider: string) => 'provider not supported',
      clientPackageNotSupported: (_pkg: string) => 'client package not supported',
    },
  },
}))();

mock.module('../../../../../src/core/llm/factory.js', () => ({
  createRuntimeLlm: hoisted.createRuntimeLlm,
}));

mock.module('../../../../../src/core/observability/logger.js', () => ({
  logger: hoisted.logger,
}));

mock.module('../../../../../src/cli/locales/index.js', () => ({
  text: hoisted.text,
}));

function fakeLlm(id: string) {
  return {
    async chat() {
      return { role: 'assistant' as const, content: id };
    },
    async createPlan() {
      return { goal: id, files: [], changes: [], verify: '' };
    },
    async createPatch() {
      return id;
    },
  };
}

describe('createRuntimeLlmAndWarn', () => {
  beforeEach(() => {
    mock.clearAllMocks();
    hoisted.createRuntimeLlm.mockImplementation((cfg: any) => ({
      llm: fakeLlm(cfg.models?.selectedModelId || 'default-model'),
      backend: 'stub',
      warnings: [],
    }));
  });

  it('creates per-phase llm instances from llm.routing.phaseToProviderModel and routes chat by phase', async () => {
    const { createRuntimeLlmAndWarn } =
      await import('../../../../../src/cli/commands/run/runtime-llm.js');

    const result = createRuntimeLlmAndWarn({
      llmConfig: {
        type: 'openai-compatible',
        models: { selectedModelId: 'default-model' },
        routing: {
          phaseToProviderModel: {
            PLAN: {
              id: 'openaiMain',
              type: 'openai-compatible',
              api: { apiKey: 'k', apiKeySource: 'inline' },
              model: { id: 'plan-model', slot: 'plan' },
            },
            PATCH: {
              id: 'openaiMain',
              type: 'openai-compatible',
              api: { apiKey: 'k', apiKeySource: 'inline' },
              model: { id: 'patch-model', slot: 'patch' },
            },
          },
        },
      },
      langfuseEnabled: false,
    });

    expect(hoisted.createRuntimeLlm).toHaveBeenCalledTimes(3);
    expect(await result.llm.chat([{ role: 'user', content: 'x' }], { phase: 'PLAN' })).toEqual({
      role: 'assistant',
      content: 'plan-model',
    });
    expect(await result.llm.chat([{ role: 'user', content: 'x' }], { phase: 'PATCH' })).toEqual({
      role: 'assistant',
      content: 'patch-model',
    });
    expect(await result.llm.chat([{ role: 'user', content: 'x' }], { phase: 'VERIFY' })).toEqual({
      role: 'assistant',
      content: 'default-model',
    });
  });
});
