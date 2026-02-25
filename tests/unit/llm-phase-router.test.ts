import { createPhaseRoutingLlm } from '../../src/core/llm/phase-router.js';
import { Phase, type LLM, type LLMMessage } from '../../src/core/types/index.js';

function makeLlm(modelId: string): LLM {
  return {
    async chat(_messages: LLMMessage[]) {
      return { role: 'assistant', content: modelId };
    },
    async *chatStream(_messages: LLMMessage[]) {
      yield { role: 'assistant', contentDelta: modelId };
      yield { role: 'assistant', done: true };
    },
    getModelId() {
      return modelId;
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
});
