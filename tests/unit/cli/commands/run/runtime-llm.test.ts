import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

import { clearLogger, setLogger } from '../../../../../src/core/observability/logger.js';

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
  afterAll(() => {
    mock.restore();
    clearLogger();
  });

  beforeEach(() => {
    mock.clearAllMocks();
    setLogger(hoisted.logger as any);
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

  it('routes AUTOPILOT model overrides even though AUTOPILOT is outside the main phase list', async () => {
    const { createRuntimeLlmAndWarn } =
      await import('../../../../../src/cli/commands/run/runtime-llm.js');

    const result = createRuntimeLlmAndWarn({
      llmConfig: {
        type: 'openai-compatible',
        models: { selectedModelId: 'default-model' },
        routing: {
          phaseToProviderModel: {
            AUTOPILOT: {
              id: 'openaiMain',
              type: 'openai-compatible',
              api: { apiKey: 'k', apiKeySource: 'inline' },
              model: { id: 'autopilot-model', slot: 'autopilot' },
            },
          },
        },
      },
      langfuseEnabled: false,
    });

    expect(await result.llm.chat([{ role: 'user', content: 'x' }], { phase: 'AUTOPILOT' })).toEqual(
      {
        role: 'assistant',
        content: 'autopilot-model',
      },
    );
  });

  it('returns structured warnings without logging in headless mode', async () => {
    hoisted.createRuntimeLlm.mockImplementation((cfg: any) => ({
      llm: fakeLlm(cfg.models?.selectedModelId || 'default-model'),
      backend: 'stub',
      warnings: ['API_KEY_MISSING'],
    }));

    const { createRuntimeLlmAndWarn } =
      await import('../../../../../src/cli/commands/run/runtime-llm.js');

    const result = createRuntimeLlmAndWarn({
      llmConfig: {
        type: 'openai-compatible',
        models: { selectedModelId: 'default-model' },
      },
      langfuseEnabled: false,
      headlessOutput: true,
    });

    expect(hoisted.logger.warn).not.toHaveBeenCalled();
    expect(result.warnings).toEqual(['API_KEY_MISSING']);
    expect(result.headlessWarnings).toEqual([
      {
        code: 'LLM_CREDENTIAL_MISSING',
        message:
          'LLM credential not configured; using StubLLM. Configure provider credentials to use a real LLM.',
        source: 'llm.runtime',
        severity: 'warning',
      },
    ]);
  });
});
