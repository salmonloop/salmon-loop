import { TransactionContext } from '../../shared/types/grizzco-types.js';

import { DecisionResult } from './types.js';

export interface ExecutionPlan {
  shouldAbort: boolean;
  abortReason?: string;
  workerId?: string;
  actions: Array<{ type: string; params?: any }>;
  decisionTree: string;
}

export class PlanBuilder<C extends BaseDslContext = DslContext> {
  private plan: ExecutionPlan = {
    shouldAbort: false,
    actions: [],
    decisionTree: '',
  };
  private _ctx?: C;

  bindContext(ctx: C): this {
    this._ctx = ctx;
    return this;
  }

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

  get ctx(): C {
    if (!this._ctx) throw new Error('PlanBuilder: context not bound');
    return this._ctx;
  }
}

export interface DecisionRecord {
  index: number;
  phase: string;
  rule: string;
  matched: boolean;
  metadata?: any;
}

// Base DSL context, containing only dynamic data
export interface BaseDslContext {
  data?: Record<string, any>;
}

// Extended context (retained as default type for file transactions)
export interface DslContext extends BaseDslContext, TransactionContext {}

export class DecisionEngine<C extends BaseDslContext = DslContext> {
  private history: DecisionRecord[] = [];
  private currentPhase: string = 'initialization';
  private missingDataKeys: Set<string> = new Set();
  private recordCounter: number = 0;

  constructor(
    public readonly ctx: C,
    private planBuilder: PlanBuilder<C>,
  ) {
    this.planBuilder.bindContext(ctx);
  }

  phase(name: string): this {
    this.currentPhase = name;
    return this;
  }

  /**
   * Declare data dependency. Supports single key or array of keys.
   * COMPLIANCE: DSL-Spec-V3 - Explicitly tracks missing keys for the Ping-Pong protocol.
   */
  requireData(keyOrKeys: string | string[], reason?: string): this {
    const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];

    for (const key of keys) {
      if (!this.ctx.data || this.ctx.data[key] === undefined) {
        this.missingDataKeys.add(key);
        this.recordDecision(false, () => `requireData('${key}')`, { reason });
      } else {
        this.recordDecision(true, () => `requireData('${key}')`, { val: this.ctx.data[key] });
      }
    }

    return this;
  }

  require(predicate: (c: C) => boolean, msg: string): this {
    if (this.missingDataKeys.size > 0) return this;

    const matched = predicate(this.ctx);
    this.recordDecision(matched, predicate, { type: 'require', msg });
    if (!matched) {
      this.planBuilder.abort(msg);
    }
    return this;
  }

  when(predicate: (c: C) => boolean, action: (p: PlanBuilder<C>) => void): this {
    if (this.missingDataKeys.size > 0) return this;

    const matched = predicate(this.ctx);
    this.recordDecision(matched, predicate, { type: 'when' });
    if (matched) {
      action(this.planBuilder);
    }
    return this;
  }

  unless(predicate: (c: C) => boolean, action: (p: PlanBuilder<C>) => void): this {
    return this.when((c) => !predicate(c), action);
  }

  apply(fragment: (engine: DecisionEngine<C>) => DecisionEngine<C>): this {
    if (this.missingDataKeys.size > 0) return this;
    fragment(this);
    return this;
  }

  build(): DecisionResult {
    if (this.missingDataKeys.size > 0) {
      return {
        type: 'NEED_DATA',
        keys: Array.from(this.missingDataKeys),
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
      index: this.recordCounter++,
      phase: this.currentPhase,
      rule: predicate.toString().slice(0, 100),
      matched,
      metadata,
    });
  }

  private exportDecisionTree(): string {
    return this.history
      .map((r) => `${r.matched ? '[match]' : '[skip]'} [${r.phase}] ${r.rule}`)
      .join('\n');
  }
}
