import { createPhaseRoutingLlm } from '../../src/core/llm/phase-router.js';
import { Phase, type LLM, type LLMMessage } from '../../src/core/types/index.js';
import type { LlmCapabilities } from '../../src/core/types/llm.js';

function makeLlm(modelId: string, capabilities?: LlmCapabilities): LLM {
  const llm: LLM & { streamedCalls?: number } = {
    streamedCalls: 0,
    async chat(_messages: LLMMessage[]) {
      return { role: 'assistant', content: modelId };
    },
    getModelId() {
      return modelId;
    },
    getCapabilities() {
      return capabilities ?? {};
    },
    async createPlan() {
      return { goal: modelId, files: [], changes: [], verify: '' };
    },
    async createPatch() {
      return modelId;
    },
  };
  llm.chatStream = async function* (_messages: LLMMessage[]) {
    llm.streamedCalls = (llm.streamedCalls ?? 0) + 1;
    yield { role: 'assistant', contentDelta: modelId };
    yield { role: 'assistant', done: true };
  };
  return llm;
}

function makeNonStreamingLlm(modelId: string, capabilities?: LlmCapabilities): LLM {
  return {
    async chat(_messages: LLMMessage[]) {
      return { role: 'assistant', content: modelId };
    },
    getModelId() {
      return modelId;
    },
    getCapabilities() {
      return capabilities ?? {};
    },
    async createPlan() {
      return { goal: modelId, files: [], changes: [], verify: '' };
    },
    async createPatch() {
      return modelId;
    },
  };
}

describe('phase routing llm', () => {
  it('routes chat by phase and falls back to default for unmapped phases', async () => {
    const llm = createPhaseRoutingLlm({
      defaultLlm: makeLlm('default-model'),
      phaseLlms: {
        [Phase.PLAN]: makeLlm('plan-model'),
      },
    });

    const fromPlan = await llm.chat([{ role: 'user', content: 'x' }], { phase: Phase.PLAN });
    const fromPatch = await llm.chat([{ role: 'user', content: 'x' }], { phase: Phase.PATCH });

    expect(fromPlan.content).toBe('plan-model');
    expect(fromPatch.content).toBe('default-model');
  });

  it('routes createPlan and createPatch through PLAN/PATCH mappings when available', async () => {
    const llm = createPhaseRoutingLlm({
      defaultLlm: makeLlm('default-model'),
      phaseLlms: {
        [Phase.PLAN]: makeLlm('plan-model'),
        [Phase.PATCH]: makeLlm('patch-model'),
      },
    });

    const plan = await llm.createPlan({} as any, 'instruction');
    const patch = await llm.createPatch({} as any, {
      goal: 'g',
      files: [],
      changes: [],
      verify: '',
    });

    expect(plan.goal).toBe('plan-model');
    expect(patch).toBe('patch-model');
  });

  it('reports capabilities for the selected phase without OR-merging every phase', () => {
    const llm = createPhaseRoutingLlm({
      defaultLlm: makeLlm('default-model', { toolCalling: false, streaming: false }),
      phaseLlms: {
        [Phase.PLAN]: makeLlm('plan-model', { toolCalling: true, streaming: true }),
      },
    });

    expect(llm.getCapabilities?.()).toEqual({ toolCalling: false, streaming: false });
    expect(llm.getCapabilities?.({ phase: Phase.PLAN })).toEqual({
      toolCalling: true,
      streaming: true,
    });
    expect(llm.getCapabilities?.({ phase: Phase.PATCH })).toEqual({
      toolCalling: false,
      streaming: false,
    });
  });

  it('uses non-streaming chat for phases configured with streaming disabled', async () => {
    const patchLlm = makeLlm('patch-model', { streaming: false }) as LLM & {
      streamedCalls?: number;
    };
    const llm = createPhaseRoutingLlm({
      defaultLlm: makeNonStreamingLlm('default-model'),
      phaseLlms: {
        [Phase.PATCH]: patchLlm,
      },
    });

    const chunks: Array<{ contentDelta?: string; done?: boolean }> = [];
    for await (const chunk of llm.chatStream!([{ role: 'user', content: 'x' }], {
      phase: Phase.PATCH,
    })) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.contentDelta || '').join('')).toBe('patch-model');
    expect(chunks[chunks.length - 1]?.done).toBe(true);
    expect(patchLlm.streamedCalls).toBe(0);
  });
});
