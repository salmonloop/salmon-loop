import { beforeEach, describe, expect, it, mock } from 'bun:test';

const withAuditObservationNameMock = mock(
  async <T>(name: string, run: () => Promise<T>): Promise<T> => run(),
);

mock.module('../../src/core/llm/ai-sdk/observation-context.js', () => ({
  withAuditObservationName: withAuditObservationNameMock,
}));

mock.module('ai', () => ({
  generateText: mock(async () => ({
    text: JSON.stringify({
      goal: 'Goal',
      files: ['src/index.ts'],
      changes: ['Change'],
      verify: 'bun test',
    }),
    usage: { promptTokens: 1, completionTokens: 2 },
  })),
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

import {
  HIGH_LEVEL_PHASE_NAMES,
  HIGH_LEVEL_PHASE_SPECS,
} from '../../src/core/llm/ai-sdk/high-level-phase-specs.js';
import { AiSdkLLM } from '../../src/core/llm/ai-sdk.js';
import type { Context } from '../../src/core/types/context.js';
import type { Plan } from '../../src/core/types/planning.js';

const LARGE_CONTEXT = 'export const value = 1;\n'.repeat(400);

function createTestContext(contextHash: string): Context {
  return {
    repoPath: '/repo',
    primaryFile: 'src/index.ts',
    primaryText: LARGE_CONTEXT,
    contextHash,
    rgSnippets: [],
  };
}

function createLlm(): AiSdkLLM {
  return new AiSdkLLM({
    clientPackage: '@ai-sdk/openai-compatible',
    providerName: 'openai-compatible',
    modelId: 'test-model',
    baseUrl: 'https://example.invalid/v1',
  });
}

describe('AiSdkLLM high-level phase mapping', () => {
  beforeEach(() => {
    mock.restore();
  });

  it('keeps high-level phase specs complete for plan and patch', () => {
    expect(Object.keys(HIGH_LEVEL_PHASE_SPECS).sort()).toEqual([...HIGH_LEVEL_PHASE_NAMES].sort());

    for (const phase of HIGH_LEVEL_PHASE_NAMES) {
      const spec = HIGH_LEVEL_PHASE_SPECS[phase];
      expect(typeof spec.namespace).toBe('string');
      expect((spec.namespace as string).length).toBeGreaterThan(0);
      expect(typeof spec.observationName).toBe('string');
      expect((spec.observationName as string).length).toBeGreaterThan(0);
      expect(typeof spec.buildPrompt).toBe('function');
      expect(typeof spec.buildAttachments).toBe('function');
      expect(typeof spec.parseResult).toBe('function');
    }
  });

  it('keeps observation naming aligned with namespace naming convention', () => {
    for (const [phase, spec] of Object.entries(HIGH_LEVEL_PHASE_SPECS)) {
      const expectedPrefix = `${spec.namespace.toUpperCase()}:`;
      expect(spec.observationName.startsWith(expectedPrefix)).toBe(true);
      expect(phase).toBe(spec.namespace);
    }
  });

  it('uses PLAN observation name for createPlan', async () => {
    const llm = createLlm();
    await llm.createPlan(createTestContext('ctx-plan-map'), 'Do the plan');

    expect(withAuditObservationNameMock).toHaveBeenCalled();
    const first = withAuditObservationNameMock.mock.calls[0] as unknown[] | undefined;
    expect(first?.[0]).toBe('PLAN:plan-json');
  });

  it('uses PATCH observation name for createPatch', async () => {
    const llm = createLlm();
    const plan: Plan = {
      goal: 'Goal',
      files: ['src/index.ts'],
      changes: ['Change'],
      verify: 'bun test',
    };

    await llm.createPatch(createTestContext('ctx-patch-map'), plan);

    expect(withAuditObservationNameMock).toHaveBeenCalled();
    const first = withAuditObservationNameMock.mock.calls[0] as unknown[] | undefined;
    expect(first?.[0]).toBe('PATCH:unified-diff');
  });
});
