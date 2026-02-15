import type { ExecutionPlan } from '../../grizzco/dsl/DecisionEngine.js';
import { MicroTaskRunner } from '../../grizzco/dsl/MicroTaskRunner.js';
import { SlashStrategyDSL, type SlashDslContext } from '../strategy.js';

import type { SlashInternalData } from './types.js';

export function buildSlashDecideStep() {
  return async (context: SlashDslContext): Promise<SlashDslContext> => {
    const runner = new MicroTaskRunner<SlashDslContext>({
      debugLabel: 'SlashRouter',
      strategy: (engine) => {
        SlashStrategyDSL(engine);
        return engine;
      },
      resolveData: async () => undefined,
      maxRounds: 2,
    });

    const result = await runner.decide(context);
    const data = (context.data ?? {}) as SlashInternalData;
    return { ...context, data: { ...data, __plan: result.plan as ExecutionPlan } };
  };
}
