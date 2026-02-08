import { text } from '../../../locales/index.js';
import type { FlowMode } from '../../types.js';
import type { Pipeline } from '../pipeline.js';
import type { ExploreCtx } from '../types.js';

export interface FlowStrategy {
  readonly name: FlowMode;
  buildPipeline(base: Pipeline<ExploreCtx>): Pipeline<unknown>;
}

export class FlowStrategyRegistry {
  private strategies = new Map<FlowMode, FlowStrategy>();

  register(mode: FlowMode, strategy: FlowStrategy): void {
    if (this.strategies.has(mode)) {
      throw new Error(text.grizzco.errors.flowStrategyAlreadyRegistered(mode));
    }
    this.strategies.set(mode, strategy);
  }

  get(mode: FlowMode): FlowStrategy {
    const strategy = this.strategies.get(mode);
    if (!strategy) {
      const available = [...this.strategies.keys()].join(', ') || 'none';
      throw new Error(text.grizzco.errors.unknownFlowMode(mode, available));
    }
    return strategy;
  }

  has(mode: FlowMode): boolean {
    return this.strategies.has(mode);
  }

  list(): FlowMode[] {
    return [...this.strategies.keys()];
  }
}

export const flowRegistry = new FlowStrategyRegistry();
