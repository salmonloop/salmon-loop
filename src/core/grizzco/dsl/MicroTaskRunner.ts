import { text } from '../../../locales/index.js';

import {
  DecisionEngine,
  PlanBuilder,
  type BaseDslContext,
  type DecisionRecord,
} from './DecisionEngine.js';
import type { ExecutionPlan } from './DecisionEngine.js';

type StrategyRunner<C extends BaseDslContext> = (
  engine: DecisionEngine<C>,
) => DecisionEngine<C> | void;

type DataResolver<C extends BaseDslContext> = (ctx: C, key: string) => Promise<unknown>;

export interface MicroTaskRunnerParams<C extends BaseDslContext> {
  strategy: StrategyRunner<C>;
  resolveData: DataResolver<C>;
  maxRounds?: number;
  debugLabel?: string;
}

export interface MicroTaskRunnerResult<C extends BaseDslContext> {
  plan: ExecutionPlan;
  decisions: DecisionRecord[];
  context: C;
}

export class MicroTaskRunner<C extends BaseDslContext> {
  private readonly maxRounds: number;

  constructor(private readonly params: MicroTaskRunnerParams<C>) {
    this.maxRounds = params.maxRounds ?? 10;
  }

  async decide(context: C): Promise<MicroTaskRunnerResult<C>> {
    let rounds = 0;
    let finalEngine: DecisionEngine<C> | undefined;

    while (true) {
      if (rounds++ > this.maxRounds) {
        throw new Error(
          text.grizzco.microOrchestratorLoopStuck(this.params.debugLabel || 'unknown'),
        );
      }

      const planBuilder = new PlanBuilder<C>();
      const engine = new DecisionEngine<C>(context, planBuilder);
      finalEngine = engine;

      this.params.strategy(engine);
      const result = engine.build();

      if (result.type === 'PLAN') {
        return {
          plan: result.plan,
          decisions: finalEngine.getStructuredDecisions(),
          context,
        };
      }

      if (!context.data) {
        context.data = {};
      }
      const requiredKeys = result.keys ?? [result.key];
      await Promise.all(
        requiredKeys.map(async (key) => {
          context.data![key] = await this.params.resolveData(context, key);
        }),
      );
    }
  }
}
