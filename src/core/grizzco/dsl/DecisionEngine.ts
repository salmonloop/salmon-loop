import { TransactionContext } from '../../shared/types/grizzco-types.js';

import { DecisionResult } from './types.js';

export interface ExecutionPlan {
  shouldAbort: boolean;
  abortReason?: string;
  workerId?: string;
  actions: Array<{ type: string; params?: any }>;
  decisionTree: string;
}

export class PlanBuilder {
  private plan: ExecutionPlan = {
    shouldAbort: false,
    actions: [],
    decisionTree: '',
  };

  abort(reason: string): this {
    this.plan.shouldAbort = true;
    this.plan.abortReason = reason;
    return this;
  }

  setWorker(workerId: string): this {
    this.plan.workerId = workerId;
    return this;
  }

  addAction(type: string, params?: any): this {
    this.plan.actions.push({ type, params });
    return this;
  }

  build(): ExecutionPlan {
    return this.plan;
  }

  _setDecisionTree(tree: string): void {
    this.plan.decisionTree = tree;
  }
}

export interface DecisionRecord {
  id: string;
  phase: string;
  rule: string;
  matched: boolean;
  timestamp: number;
  metadata?: any;
}

// Extended context with dynamic data
export interface DslContext extends TransactionContext {
  data?: Record<string, any>;
}

export class DecisionEngine {
  private history: DecisionRecord[] = [];
  private currentPhase: string = 'initialization';
  private missingDataKey?: string;

  constructor(
    private ctx: DslContext,
    private planBuilder: PlanBuilder,
  ) {}

  phase(name: string): this {
    this.currentPhase = name;
    return this;
  }

  requireData(key: string, reason?: string): this {
    if (this.missingDataKey) return this;

    if (!this.ctx.data || this.ctx.data[key] === undefined) {
      this.missingDataKey = key;
      this.recordDecision(false, () => `requireData('${key}')`, { reason });
    } else {
      this.recordDecision(true, () => `requireData('${key}')`, { val: this.ctx.data[key] });
    }
    return this;
  }

  require(predicate: (c: DslContext) => boolean, msg: string): this {
    if (this.missingDataKey) return this;

    const matched = predicate(this.ctx);
    this.recordDecision(matched, predicate, { type: 'require', msg });
    if (!matched) {
      this.planBuilder.abort(msg);
    }
    return this;
  }

  when(predicate: (c: DslContext) => boolean, action: (p: PlanBuilder) => void): this {
    if (this.missingDataKey) return this;

    const matched = predicate(this.ctx);
    this.recordDecision(matched, predicate, { type: 'when' });
    if (matched) {
      action(this.planBuilder);
    }
    return this;
  }

  unless(predicate: (c: DslContext) => boolean, action: (p: PlanBuilder) => void): this {
    return this.when((c) => !predicate(c), action);
  }

  apply(fragment: (engine: DecisionEngine) => DecisionEngine): this {
    if (this.missingDataKey) return this;
    fragment(this);
    return this;
  }

  build(): DecisionResult {
    if (this.missingDataKey) {
      return {
        type: 'NEED_DATA',
        key: this.missingDataKey,
      };
    }

    this.planBuilder._setDecisionTree(this.exportDecisionTree());
    return {
      type: 'PLAN',
      plan: this.planBuilder.build(),
    };
  }

  getStructuredDecisions(): DecisionRecord[] {
    return [...this.history];
  }

  private recordDecision(
    matched: boolean,
    predicate: (...args: any[]) => any,
    metadata?: any,
  ): void {
    this.history.push({
      id: Math.random().toString(36).substring(7),
      phase: this.currentPhase,
      rule: predicate.toString().slice(0, 100),
      matched,
      timestamp: Date.now(),
      metadata,
    });
  }

  private exportDecisionTree(): string {
    return this.history.map((r) => `${r.matched ? '✅' : '⏭️'} [${r.phase}] ${r.rule}`).join('\n');
  }
}
